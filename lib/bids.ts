import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { creditOp, CreditError } from './credits';
import { getBidSettings, type BidSettings } from './settings';

export class BidError extends Error {}
export type Prop = { id: string; provider_id: string; price_cents: number; delivery_days: number; message: string; status: string; boost_credits: number; boost_max: number; boost_target: number; boost_at: Date | null; created_at: Date };

export async function lockJob(c: PoolClient, jobId: string) {
  const j = (await c.query('select * from jobs where id=$1 for update', [jobId])).rows[0];
  if (!j) throw new BidError('Заданието не съществува');
  return j;
}
export async function liveProposals(c: PoolClient, jobId: string): Promise<Prop[]> {
  return (await c.query("select * from proposals where job_id=$1 and status='submitted'", [jobId])).rows;
}
const cmp = (a: Prop, b: Prop) => b.boost_credits - a.boost_credits || +new Date(a.boost_at ?? 0) - +new Date(b.boost_at ?? 0);
/** Топ слотове по залог; при равенство печели по-рано потвърденият залог. */
export function rank<T extends Prop>(props: T[], s: BidSettings) {
  const sorted = props.filter((p) => p.boost_credits > 0).sort(cmp);
  const sponsored = sorted.slice(0, s.slots), ids = new Set(sponsored.map((p) => p.id));
  return { sponsored, organic: props.filter((p) => !ids.has(p.id)) };
}
export function threshold<T extends Prop>(props: T[], s: BidSettings) {
  const { sponsored } = rank(props, s);
  return sponsored.length < s.slots ? s.min_boost : sponsored[s.slots - 1].boost_credits + s.step;
}
async function nextKey(c: PoolClient, prefix: string, proposalId: string) {
  const n = (await c.query('select count(*)::int n from credit_transactions where related=$1', [proposalId])).rows[0].n;
  return `${prefix}:${proposalId}:${n}`;
}
async function raiseTo(c: PoolClient, p: Prop, amount: number, actor: string) {
  const delta = amount - p.boost_credits;
  await creditOp(c, { userId: p.provider_id, type: 'hold_boost', amount: delta, key: await nextKey(c, 'hold', p.id), related: p.id, actor });
  await c.query('update proposals set boost_credits=$2, boost_at=clock_timestamp() where id=$1', [p.id, amount]);
  p.boost_credits = amount; p.boost_at = new Date();
}
/** Auto Boost: вдига със стъпка само колкото трябва за желаната позиция, до зададения максимум. */
export async function runAuto(c: PoolClient, jobId: string, s?: BidSettings) {
  s ??= await getBidSettings(c);
  const props = await liveProposals(c, jobId);
  for (let guard = 0, changed = true; changed && guard < 500; guard++) {
    changed = false;
    for (const p of props) {
      if (p.boost_max <= 0) continue;
      const others = props.filter((o) => o.id !== p.id).sort(cmp);
      const ref = others[p.boost_target - 1];
      const need = Math.max(s.min_boost, ref ? ref.boost_credits + s.step : 0);
      if (p.boost_credits >= need) continue;
      const to = Math.min(need, p.boost_max);
      if (to < need || to <= p.boost_credits) continue;
      const w = (await c.query('select available from credit_wallets where user_id=$1', [p.provider_id])).rows[0];
      if (!w || w.available < to - p.boost_credits) continue;   // без средства Auto Boost просто спира
      await raiseTo(c, p, to, p.provider_id); changed = true;
    }
  }
}

export async function submitProposal(c: PoolClient, i: { jobId: string; providerId: string; price: number; days: number; message: string; boost: number; max: number; target: number }) {
  const s = await getBidSettings(c);
  const job = await lockJob(c, i.jobId);
  if (job.status !== 'open' || new Date(job.deadline) < new Date(new Date().toDateString())) throw new BidError('Заданието не приема оферти');
  if (job.client_id === i.providerId) throw new BidError('Не можете да кандидатствате за собствено задание');
  const sub = await c.query("select 1 from subscriptions where provider_id=$1 and status='active' and period_end>now()", [i.providerId]);
  if (!sub.rowCount) throw new BidError('Нужен е активен платен план, за да кандидатствате');
  if ((await c.query("select 1 from proposals where job_id=$1 and provider_id=$2 and status in ('submitted','accepted')", [i.jobId, i.providerId])).rowCount) throw new BidError('Вече имате оферта за това задание');
  if (!(i.price > 0) || !(i.days > 0)) throw new BidError('Цената и срокът трябва да са положителни');
  if (i.boost < 0 || i.max < 0) throw new BidError('Кредитите не могат да са отрицателни');
  if (i.boost > 0 && i.boost < s.min_boost) throw new BidError(`Минималният boost е ${s.min_boost} кредита`);
  if (i.max > 0 && i.max < i.boost) throw new BidError('Максимумът за Auto Boost не може да е под текущия boost');
  const id = randomUUID();
  await c.query('insert into proposals(id,job_id,provider_id,price_cents,delivery_days,message,boost_target,boost_max) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, i.jobId, i.providerId, i.price, i.days, i.message, i.target, i.max]);
  await c.query('insert into proposal_versions(proposal_id,version,price_cents,delivery_days,message) values ($1,1,$2,$3,$4)', [id, i.price, i.days, i.message]);
  try {
    await creditOp(c, { userId: i.providerId, type: 'debit_application', amount: s.app_cost, key: `app:${id}`, related: id, actor: i.providerId });
    if (i.boost > 0) await raiseTo(c, { id, provider_id: i.providerId, boost_credits: 0 } as Prop, i.boost, i.providerId);
  } catch (e) { if (e instanceof CreditError) throw new BidError(`Недостатъчно кредити (нужни: ${s.app_cost + i.boost})`); throw e; }
  await runAuto(c, i.jobId, s);
  return id;
}

async function ownProposal(c: PoolClient, proposalId: string, providerId: string) {
  const p = (await c.query('select * from proposals where id=$1', [proposalId])).rows[0] as Prop & { job_id: string };
  if (!p || p.provider_id !== providerId) throw new BidError('Офертата не е намерена');
  const job = await lockJob(c, p.job_id);
  const fresh = (await c.query('select * from proposals where id=$1', [proposalId])).rows[0] as Prop;
  if (job.status !== 'open' || fresh.status !== 'submitted') throw new BidError('Търгът е затворен');
  return { p: fresh, jobId: job.id as string };
}
export async function raiseBoost(c: PoolClient, proposalId: string, providerId: string, amount: number) {
  const s = await getBidSettings(c); const { p, jobId } = await ownProposal(c, proposalId, providerId);
  const min = p.boost_credits > 0 ? p.boost_credits + s.step : s.min_boost;
  if (!Number.isInteger(amount) || amount < min) throw new BidError(`Минимумът е ${min} кредита`);
  try { await raiseTo(c, p, amount, providerId); } catch (e) { if (e instanceof CreditError) throw new BidError('Недостатъчно кредити'); throw e; }
  await runAuto(c, jobId, s);
}
export async function setAuto(c: PoolClient, proposalId: string, providerId: string, max: number, target: number) {
  const { p, jobId } = await ownProposal(c, proposalId, providerId);
  if (max < 0 || (max > 0 && max < p.boost_credits)) throw new BidError('Максимумът не може да е под текущия boost');
  await c.query('update proposals set boost_max=$2, boost_target=$3 where id=$1', [proposalId, max, target]);
  await runAuto(c, jobId);
}
export async function stopBoost(c: PoolClient, proposalId: string, providerId: string) {
  const { p, jobId } = await ownProposal(c, proposalId, providerId);
  if (p.boost_credits > 0) {
    await creditOp(c, { userId: providerId, type: 'release_boost', amount: p.boost_credits, key: await nextKey(c, 'rel', p.id), related: p.id, actor: providerId });
  }
  await c.query('update proposals set boost_credits=0, boost_max=0, boost_at=null where id=$1', [proposalId]);
  await runAuto(c, jobId);
}
export async function withdrawProposal(c: PoolClient, proposalId: string, providerId: string) {
  await stopBoost(c, proposalId, providerId);
  await c.query("update proposals set status='withdrawn' where id=$1", [proposalId]);
}

/**
 * Затваряне на пазара. Победителите в спонсорираните слотове се таксуват (settle),
 * всички останали залози се освобождават. Всичко е в една транзакция.
 * winnerId = null означава отказано задание: всичко се освобождава.
 */
export async function settleJob(c: PoolClient, jobId: string, charge: boolean) {
  const s = await getBidSettings(c);
  const all = (await c.query("select * from proposals where job_id=$1 and boost_credits>0", [jobId])).rows as Prop[];
  const winners = new Set(rank(all, s).sponsored.map((p) => p.id));
  for (const p of all) {
    const settle = charge && winners.has(p.id);
    await creditOp(c, { userId: p.provider_id, type: settle ? 'settle_boost' : 'release_boost', amount: p.boost_credits, key: `${settle ? 'settle' : 'release'}:${p.id}`, related: p.id, actor: null });
  }
  await c.query('update proposals set boost_credits=0, boost_max=0 where job_id=$1 and boost_credits>0', [jobId]);
}
