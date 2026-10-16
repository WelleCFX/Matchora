'use server';
import { redirect } from 'next/navigation';
import { guarded, requireProvider, requireVerified } from '@/lib/guard';
import { handleWebhook, paymentProvider, startCheckout } from '@/lib/billing';
import { cancelAtPeriodEnd, createCheckoutSession } from '@/lib/stripe';
import { BidError } from '@/lib/bids';
import { q } from '@/lib/db';
import { randomBytes } from 'node:crypto';

export async function checkoutAction(f: FormData) {
  const kind = f.get('kind') === 'credits' ? 'credits' : 'subscription';
  const s = kind === 'credits' ? await requireProvider() : await requireProvider();
  const ref = String(f.get('ref') ?? '');
  const id = await startCheckout(s.id, kind, ref).catch((err) => { console.error('checkout error', err); return null; });
  if (!id) redirect(`${kind === 'credits' ? '/credits' : '/subscription'}?e=${encodeURIComponent('Невалиден избор')}`);
  if (paymentProvider() === 'stripe') {
    const p = (await q(`select p.amount_cents, coalesce(pl.name, 'Пакет '||cp.credits||' кредита') label from payments p left join plans pl on pl.id=p.ref and p.kind='subscription' left join credit_packages cp on cp.id=p.ref and p.kind='credits' where p.id=$1`, [id]))[0];
    const sess = await createCheckoutSession({ paymentId: id!, kind, name: kind === 'subscription' ? `Matchora абонамент ${p.label}` : `Matchora ${p.label}`, amountCents: p.amount_cents, email: s.email, appUrl: process.env.APP_URL! });
    await q('update payments set provider_payment_id=$2 where id=$1', [id, sess.id]);
    redirect(sess.url);
  }
  redirect(`/pay/${id}`);
}

export async function cancelRenewalAction() {
  const s = await requireProvider();
  return guarded('/subscription', async () => {
    const sub = (await q("select * from subscriptions where provider_id=$1 and status='active' and period_end>now()", [s.id]))[0];
    if (!sub) throw new BidError('Нямате активен абонамент');
    if (paymentProvider() === 'stripe' && sub.provider_subscription_id && !/^sub_[0-9a-f-]{36}$/.test(sub.provider_subscription_id)) await cancelAtPeriodEnd(sub.provider_subscription_id);
    await q('update subscriptions set cancel_at_period_end=true where id=$1', [sub.id]);
  });
}

/**
 * Само за mock доставчика (разработка и демо): изпраща същото подписано събитие, което реален доставчик
 * би изпратил към /api/webhooks/payments, и го обработва през същата идемпотентна функция.
 */
export async function simulatePaymentAction(f: FormData) {
  if (paymentProvider() !== 'mock') throw new Error('Недостъпно');
  const s = await requireVerified();
  const id = String(f.get('paymentId'));
  const p = (await q('select provider_payment_id, kind from payments where id=$1 and user_id=$2', [id, s.id]))[0];
  if (!p) throw new BidError('Плащането не е намерено');
  const ev = { id: String(f.get('eventId') || `evt_${randomBytes(8).toString('hex')}`), type: 'payment.succeeded' as const, payment_id: p.provider_payment_id };
  const r = await handleWebhook(ev);
  redirect(`/pay/${id}?r=${r}&ev=${ev.id}`);
}
