import type { PoolClient } from 'pg';
import { BidError, lockJob, settleJob } from './bids';
import { notify } from './notify';

export const BANNED = ['казино', 'бързи пари', 'крипто инвестиция'];
export const needsReview = (text: string) => BANNED.some((w) => text.toLowerCase().includes(w));

export async function acceptProposal(c: PoolClient, clientId: string, proposalId: string) {
  const p = (await c.query('select * from proposals where id=$1', [proposalId])).rows[0];
  if (!p) throw new BidError('Офертата не е намерена');
  const job = await lockJob(c, p.job_id);
  if (job.client_id !== clientId) throw new BidError('Само собственикът на заданието може да приеме оферта');
  const fresh = (await c.query('select status from proposals where id=$1', [proposalId])).rows[0];
  if (job.status !== 'open' || fresh.status !== 'submitted') throw new BidError('Заданието вече е затворено или офертата не е активна');
  await c.query("update proposals set status='accepted' where id=$1", [proposalId]);
  const others = (await c.query("update proposals set status='rejected' where job_id=$1 and id<>$2 and status='submitted' returning provider_id", [job.id, proposalId])).rows;
  await c.query("update jobs set status='closed', accepted_proposal_id=$2, closed_at=now() where id=$1", [job.id, proposalId]);
  await settleJob(c, job.id, true);
  const order = (await c.query("insert into orders(job_id,proposal_id,client_id,provider_id,price_cents) values ($1,$2,$3,$4,$5) returning id", [job.id, proposalId, clientId, p.provider_id, p.price_cents])).rows[0];
  await c.query("insert into order_events(order_id,actor_id,to_status) values ($1,$2,'accepted')", [order.id, clientId]);
  await c.query("insert into messages(order_id,sender_id,body,system) values ($1,$2,'Офертата е приета. Договорете детайлите тук.',true)", [order.id, clientId]);
  await notify(c, p.provider_id, 'proposal_accepted', `Офертата ви за „${job.title}“ е приета`, `/orders/${order.id}`);
  for (const o of others) await notify(c, o.provider_id, 'proposal_rejected', `Заданието „${job.title}“ е затворено`, `/jobs/${job.id}`);
  return order.id as string;
}

export async function cancelJob(c: PoolClient, actorId: string, jobId: string, staff: boolean) {
  const job = await lockJob(c, jobId);
  if (job.client_id !== actorId && !staff) throw new BidError('Нямате право да откажете това задание');
  if (!['open', 'pending_review'].includes(job.status)) throw new BidError('Заданието вече е затворено');
  await c.query("update jobs set status='cancelled', closed_at=now() where id=$1", [jobId]);
  await settleJob(c, jobId, false);                         // резервираните boost кредити се освобождават
  const ps = (await c.query("update proposals set status='rejected' where job_id=$1 and status='submitted' returning provider_id", [jobId])).rows;
  for (const p of ps) await notify(c, p.provider_id, 'job_cancelled', `Заданието „${job.title}“ е отказано`, `/jobs/${jobId}`);
}

const NEXT: Record<string, { to: string; by: 'provider' | 'client' }> = {
  accepted: { to: 'scheduled', by: 'provider' }, scheduled: { to: 'in_progress', by: 'provider' },
  in_progress: { to: 'delivered', by: 'provider' }, delivered: { to: 'completed', by: 'client' },
};
export function nextStep(status: string) { return NEXT[status] ?? null; }
export async function advanceOrder(c: PoolClient, actorId: string, orderId: string, expectedTo: string) {
  const o = (await c.query('select * from orders where id=$1 for update', [orderId])).rows[0];
  if (!o) throw new BidError('Поръчката не е намерена');
  const step = NEXT[o.status];
  if (!step || step.to !== expectedTo) throw new BidError('Невалидна промяна на статуса');
  if ((step.by === 'provider' ? o.provider_id : o.client_id) !== actorId) throw new BidError('Нямате право за тази стъпка');
  await c.query('update orders set status=$2, updated_at=now() where id=$1', [orderId, step.to]);
  await c.query('insert into order_events(order_id,actor_id,from_status,to_status) values ($1,$2,$3,$4)', [orderId, actorId, o.status, step.to]);
  const other = actorId === o.client_id ? o.provider_id : o.client_id;
  await notify(c, other, 'order_status', `Поръчката е със статус: ${step.to}`, `/orders/${orderId}`);
}
