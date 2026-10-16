import { createHmac, timingSafeEqual } from 'node:crypto';
import { q, tx } from './db';
import { handleWebhook, PERIOD_DAYS } from './billing';
import { notify } from './notify';

const API = 'https://api.stripe.com/v1';
const key = () => { const k = process.env.STRIPE_SECRET_KEY; if (!k) throw new Error('STRIPE_SECRET_KEY липсва'); return k; };
const form = (o: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));

async function call(path: string, body: URLSearchParams, idem?: string) {
  const r = await fetch(API + path, { method: 'POST', body, headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(idem ? { 'Idempotency-Key': idem } : {}) } });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Stripe: ${j?.error?.message ?? r.status}`);
  return j;
}

/** Хоствана страница за плащане на Stripe. Картови данни никога не минават през нашия сървър. */
export async function createCheckoutSession(p: { paymentId: string; kind: 'subscription' | 'credits'; name: string; amountCents: number; email: string; appUrl: string }) {
  const sub = p.kind === 'subscription';
  const f: Record<string, string | number> = {
    mode: sub ? 'subscription' : 'payment', client_reference_id: p.paymentId, customer_email: p.email,
    'metadata[payment_id]': p.paymentId,
    'line_items[0][quantity]': 1, 'line_items[0][price_data][currency]': 'eur', 'line_items[0][price_data][unit_amount]': p.amountCents,
    'line_items[0][price_data][product_data][name]': p.name,
    success_url: `${p.appUrl}/${sub ? 'subscription' : 'credits'}?paid=1`, cancel_url: `${p.appUrl}/${sub ? 'subscription' : 'credits'}`,
  };
  if (sub) { f['line_items[0][price_data][recurring][interval]'] = 'month'; f['subscription_data[metadata][payment_id]'] = p.paymentId; }
  const s = await call('/checkout/sessions', form(f), `checkout-${p.paymentId}`);
  return { id: s.id as string, url: s.url as string };
}
export async function cancelAtPeriodEnd(stripeSubId: string) { await call(`/subscriptions/${stripeSubId}`, form({ cancel_at_period_end: 'true' })); }

/** Stripe-Signature: t=<unix>,v1=<hmac_sha256(`${t}.${body}`)>[,v1=...]. Допуск 5 мин. срещу повторение. */
export function verifyStripeSignature(body: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), tolerance = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((x) => x.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1], sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(nowSec - Number(t)) > tolerance) return false;
  const exp = Buffer.from(createHmac('sha256', secret).update(`${t}.${body}`).digest('hex'));
  return sigs.some((s) => { const b = Buffer.from(s); return b.length === exp.length && timingSafeEqual(b, exp); });
}

/** Обработва събитие. Връща true, ако е променило състояние. Идемпотентно по event.id (payment_events). */
export async function handleStripeEvent(ev: any): Promise<'processed' | 'duplicate' | 'ignored'> {
  const o = ev?.data?.object ?? {};
  switch (ev.type) {
    case 'checkout.session.completed': {
      if (o.payment_status !== 'paid') return 'ignored';       // отложени методи чакат async_payment_succeeded
    }
    // fallthrough
    case 'checkout.session.async_payment_succeeded': {
      const r = await handleWebhook({ id: ev.id, type: 'payment.succeeded', payment_id: o.id });
      if (r === 'processed') {
        await q('update payments set provider_intent=$2 where provider_payment_id=$1', [o.id, o.payment_intent ?? null]);
        if (o.subscription) await q(`update subscriptions set provider_subscription_id=$2 where id = (select s.id from subscriptions s join payments p on p.user_id=s.provider_id where p.provider_payment_id=$1 and s.status='active' order by s.created_at desc limit 1)`, [o.id, o.subscription]);
      }
      return r === 'processed' ? 'processed' : 'duplicate';
    }
    case 'checkout.session.expired': case 'checkout.session.async_payment_failed': {
      const r = await handleWebhook({ id: ev.id, type: 'payment.failed', payment_id: o.id });
      return r === 'processed' ? 'processed' : 'duplicate';
    }
    case 'invoice.paid': {
      if (o.billing_reason !== 'subscription_cycle') return 'ignored';     // първата вноска е в checkout.session.completed
      const subId = o.subscription ?? o.parent?.subscription_details?.subscription;
      const end = o.lines?.data?.[0]?.period?.end;
      return tx(async (c) => {
        const ins = await c.query('insert into payment_events(provider_event_id,type,payload) values ($1,$2,$3) on conflict do nothing', [ev.id, ev.type, JSON.stringify(ev)]);
        if (!ins.rowCount) return 'duplicate';
        const s = (await c.query('select * from subscriptions where provider_subscription_id=$1 for update', [subId])).rows[0];
        if (!s) return 'ignored';
        const newEnd = new Date(Math.max(+new Date(s.period_end), (end ? end * 1000 : Date.now() + PERIOD_DAYS * 864e5)));
        await c.query("update subscriptions set period_end=$2, status='active' where id=$1", [s.id, newEnd]);
        await notify(c, s.provider_id, 'subscription', 'Абонаментът е подновен', '/subscription');
        return 'processed';
      });
    }
    case 'invoice.payment_failed': {
      const subId = o.subscription ?? o.parent?.subscription_details?.subscription;
      const s = (await q('select provider_id from subscriptions where provider_subscription_id=$1', [subId]))[0];
      if (s) await tx((c) => notify(c, s.provider_id, 'subscription', 'Неуспешно подновяване на абонамента. Обновете платежния метод.', '/subscription'));
      return 'ignored';
    }
    case 'customer.subscription.updated': case 'customer.subscription.deleted': {
      const gone = ev.type === 'customer.subscription.deleted';
      await q(`update subscriptions set cancel_at_period_end=$2, status = case when $3 then 'canceled' else status end where provider_subscription_id=$1`, [o.id, !!o.cancel_at_period_end || gone, gone]);
      return 'processed';
    }
    case 'charge.refunded': case 'charge.dispute.created': {
      // Не отнемаме кредити автоматично: администратор преглежда (кредитите може вече да са похарчени).
      const st = ev.type === 'charge.refunded' ? 'refunded' : 'disputed';
      const r = await q(`update payments set status=$2, review_note='Чака преглед от администратор' where provider_intent=$1 and status='paid' returning id, user_id`, [o.payment_intent, st]);
      for (const p of r) await q(`insert into audit_logs(actor_id, action, metadata) values (null, 'payment_${st}_needs_review', $1)`, [JSON.stringify({ paymentId: p.id, userId: p.user_id })]);
      return r.length ? 'processed' : 'ignored';
    }
    default: return 'ignored';
  }
}
