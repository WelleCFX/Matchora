import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { q, tx } from './db';
import { creditOp } from './credits';
import { notify } from './notify';

export const PERIOD_DAYS = 30;
/** В продукция тестовият доставчик е изключен по подразбиране, за да не може никой да „плаща“ без пари. */
export const paymentProvider = () => process.env.PAYMENT_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 'none' : 'mock');
const secret = () => {
  if (process.env.WEBHOOK_SECRET) return process.env.WEBHOOK_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('WEBHOOK_SECRET е задължителен в продукция');
  return 'dev-webhook-secret-change-me';
};
export const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('hex');
export function verifySignature(body: string, sig: string | null): boolean {
  if (!sig) return false;
  const a = Buffer.from(sign(body)), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const eur = (cents: number) => (cents / 100).toLocaleString('bg-BG', { style: 'currency', currency: 'EUR' });

export async function activePlan(providerId: string) {
  return (await q(`select s.*, p.name, p.active_limit from subscriptions s join plans p on p.id=s.plan_id
                    where s.provider_id=$1 and s.status='active' and s.period_end>now()`, [providerId]))[0] ?? null;
}

/** Създава чакащо плащане. Права и кредити се дават САМО след потвърден webhook. */
export async function startCheckout(userId: string, kind: 'subscription' | 'credits', ref: string) {
  if (paymentProvider() === 'none') throw new Error('Платежният доставчик не е настроен');
  const row = kind === 'subscription'
    ? (await q('select price_cents from plans where id=$1 and is_active', [ref]))[0]
    : (await q('select price_cents from credit_packages where id=$1 and is_active', [ref]))[0];
  if (!row) throw new Error('Невалиден избор');
  const pid = `mock_${randomBytes(8).toString('hex')}`;
  return (await q('insert into payments(user_id,kind,ref,amount_cents,provider,provider_payment_id) values ($1,$2,$3,$4,$5,$6) returning id',
    [userId, kind, ref, row.price_cents, paymentProvider(), pid]))[0].id as string;
}

async function applyPaid(c: PoolClient, pay: any) {
  if (pay.kind === 'credits') {
    const pk = (await c.query('select credits from credit_packages where id=$1', [pay.ref])).rows[0];
    await creditOp(c, { userId: pay.user_id, type: 'purchase', amount: pk.credits, key: `pay:${pay.id}`, related: pay.id, actor: null });
    await notify(c, pay.user_id, 'credits', `Добавени са ${pk.credits} кредита`, '/credits');
  } else {
    const cur = (await c.query("select * from subscriptions where provider_id=$1 and status='active' and period_end>now() for update", [pay.user_id])).rows[0];
    const base = cur && cur.plan_id === pay.ref ? new Date(cur.period_end) : new Date();   // подновяване удължава периода
    const end = new Date(base.getTime() + PERIOD_DAYS * 864e5);
    if (cur) await c.query("update subscriptions set status='canceled' where id=$1", [cur.id]);
    await c.query("insert into subscriptions(provider_id,plan_id,status,period_end,provider_subscription_id) values ($1,$2,'active',$3,$4)", [pay.user_id, pay.ref, end, `sub_${pay.id}`]);
    await notify(c, pay.user_id, 'subscription', 'Абонаментът е активен', '/subscription');
  }
  const n = (await c.query("select nextval('invoice_seq') n")).rows[0].n;
  await c.query('insert into invoices(payment_id,number,amount_cents) values ($1,$2,$3) on conflict do nothing', [pay.id, `MT-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`, pay.amount_cents]);
}

/** Идемпотентно: едно и също събитие (или повторно плащане) не начислява два пъти. */
export async function handleWebhook(event: { id: string; type: 'payment.succeeded' | 'payment.failed'; payment_id: string }): Promise<'processed' | 'duplicate' | 'unknown'> {
  return tx(async (c) => {
    const pay = (await c.query('select * from payments where provider_payment_id=$1 for update', [event.payment_id])).rows[0];
    if (!pay) return 'unknown';
    const ins = await c.query('insert into payment_events(provider_event_id,payment_id,type,payload) values ($1,$2,$3,$4) on conflict do nothing', [event.id, pay.id, event.type, JSON.stringify(event)]);
    if (!ins.rowCount) return 'duplicate';
    if (event.type === 'payment.failed') { if (pay.status === 'pending') await c.query("update payments set status='failed' where id=$1", [pay.id]); return 'processed'; }
    if (pay.status === 'paid') return 'duplicate';
    await c.query("update payments set status='paid', paid_at=now() where id=$1", [pay.id]);
    await applyPaid(c, pay);
    return 'processed';
  });
}
