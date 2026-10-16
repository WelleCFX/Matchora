import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { loadEnv } from '../lib/env';
loadEnv();
import { pool, q, tx } from '../lib/db';
import { creditOp, getWallet } from '../lib/credits';
import { startCheckout } from '../lib/billing';
import { createCheckoutSession, handleStripeEvent, verifyStripeSignature } from '../lib/stripe';

after(async () => { await pool().end(); });
const tag = randomUUID().slice(0, 8);
async function provider() {
  const id = (await q('insert into users(email,password_hash,email_verified_at,is_provider) values ($1,$2,now(),true) returning id', [`st-${tag}-${randomUUID().slice(0, 4)}@t.test`, 'x']))[0].id;
  await q('insert into profiles(user_id,display_name) values ($1,$2)', [id, 'Stripe Test']); return id as string;
}
const sign = (body: string, secret: string, t: number) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const bind = async (paymentId: string, sessionId: string) => q('update payments set provider_payment_id=$2 where id=$1', [paymentId, sessionId]);

test('подпис: валиден, невалиден, остарял, подправено тяло, множество v1', () => {
  const body = '{"id":"evt_1"}', sec = 'whsec_test', t = 1_700_000_000;
  assert.equal(verifyStripeSignature(body, sign(body, sec, t), sec, t), true);
  assert.equal(verifyStripeSignature(body, sign(body, sec, t), 'whsec_other', t), false);
  assert.equal(verifyStripeSignature(body + ' ', sign(body, sec, t), sec, t), false);
  assert.equal(verifyStripeSignature(body, sign(body, sec, t), sec, t + 301), false, 'извън допуска от 5 мин.');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=dead,v1=${sign(body, sec, t).split('v1=')[1]}`, sec, t), true, 'приема се, ако поне един v1 съвпада');
  assert.equal(verifyStripeSignature(body, null, sec, t), false); assert.equal(verifyStripeSignature(body, 'garbage', sec, t), false); assert.equal(verifyStripeSignature(body, sign(body, '', t), '', t), false);
});

test('checkout сесия: правилни полета, ключ за идемпотентност, без картови данни', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const calls: { url: string; init: any }[] = [], real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 }); }) as any;
  try {
    const s = await createCheckoutSession({ paymentId: 'pay-1', kind: 'subscription', name: 'Matchora абонамент Pro', amountCents: 2490, email: 'a@b.bg', appUrl: 'https://matchora.bg' });
    assert.equal(s.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
    const c = calls[0], b = new URLSearchParams(c.init.body);
    assert.equal(c.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(c.init.headers.Authorization, 'Bearer sk_test_x'); assert.equal(c.init.headers['Idempotency-Key'], 'checkout-pay-1');
    assert.equal(b.get('mode'), 'subscription'); assert.equal(b.get('line_items[0][price_data][unit_amount]'), '2490'); assert.equal(b.get('line_items[0][price_data][recurring][interval]'), 'month');
    assert.equal(b.get('client_reference_id'), 'pay-1'); assert.equal(b.get('metadata[payment_id]'), 'pay-1');
    await createCheckoutSession({ paymentId: 'pay-2', kind: 'credits', name: 'K', amountCents: 590, email: 'a@b.bg', appUrl: 'https://x' });
    assert.equal(new URLSearchParams(calls[1].init.body).get('mode'), 'payment');
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'Невалидно' } }), { status: 400 })) as any;
    await assert.rejects(createCheckoutSession({ paymentId: 'p3', kind: 'credits', name: 'K', amountCents: 1, email: 'a@b.bg', appUrl: 'https://x' }), /Stripe: Невалидно/);
  } finally { globalThis.fetch = real; }
});

test('събития: credits се начисляват веднъж, повторение и забавено завършване не удвояват', async () => {
  const u = await provider(), pay = await startCheckout(u, 'credits', 'k150'), sid = `cs_${tag}_c`; await bind(pay, sid);
  const unpaid = { id: `evt_u_${tag}`, type: 'checkout.session.completed', data: { object: { id: sid, payment_status: 'unpaid' } } };
  assert.equal(await handleStripeEvent(unpaid), 'ignored'); assert.equal((await getWallet(u)).available, 0);
  const ok = { id: `evt_c_${tag}`, type: 'checkout.session.completed', data: { object: { id: sid, payment_status: 'paid', payment_intent: `pi_${tag}` } } };
  const rs = await Promise.all([1, 2, 3, 4].map(() => handleStripeEvent(ok)));
  assert.equal(rs.filter((r) => r === 'processed').length, 1);
  assert.equal((await getWallet(u)).available, 150);
  assert.equal(await handleStripeEvent({ ...ok, id: `evt_c2_${tag}`, type: 'checkout.session.async_payment_succeeded' }), 'duplicate');
  assert.equal((await getWallet(u)).available, 150);
});

test('абонамент: активиране, подновяване (invoice.paid), отмяна', async () => {
  const u = await provider(), pay = await startCheckout(u, 'subscription', 'pro'), sid = `cs_${tag}_s`, sub = `sub_stripe${tag}`; await bind(pay, sid);
  assert.equal((await q('select count(*)::int n from subscriptions where provider_id=$1', [u]))[0].n, 0);
  await handleStripeEvent({ id: `evt_s_${tag}`, type: 'checkout.session.completed', data: { object: { id: sid, payment_status: 'paid', subscription: sub, payment_intent: null } } });
  const row = (await q("select * from subscriptions where provider_id=$1 and status='active'", [u]))[0];
  assert.equal(row.provider_subscription_id, sub);
  const end = Math.floor(Date.now() / 1000) + 60 * 864e2;
  const inv = { id: `evt_i_${tag}`, type: 'invoice.paid', data: { object: { billing_reason: 'subscription_cycle', subscription: sub, lines: { data: [{ period: { end } }] } } } };
  assert.equal(await handleStripeEvent(inv), 'processed'); assert.equal(await handleStripeEvent(inv), 'duplicate');
  assert.equal(Math.floor(+new Date((await q('select period_end from subscriptions where id=$1', [row.id]))[0].period_end) / 1000), end);
  assert.equal(await handleStripeEvent({ id: `evt_f_${tag}`, type: 'invoice.paid', data: { object: { billing_reason: 'subscription_create', subscription: sub } } }), 'ignored', 'първата вноска не се брои два пъти');
  await handleStripeEvent({ id: `evt_u2_${tag}`, type: 'customer.subscription.updated', data: { object: { id: sub, cancel_at_period_end: true } } });
  let r = (await q('select status, cancel_at_period_end c from subscriptions where id=$1', [row.id]))[0]; assert.equal(r.status, 'active'); assert.equal(r.c, true);
  await handleStripeEvent({ id: `evt_d_${tag}`, type: 'customer.subscription.deleted', data: { object: { id: sub } } });
  r = (await q('select status from subscriptions where id=$1', [row.id]))[0]; assert.equal(r.status, 'canceled');
});

test('възстановяване/спор: плащането се маркира за преглед, кредитите не се пипат автоматично', async () => {
  const u = await provider(), pay = await startCheckout(u, 'credits', 'k50'), sid = `cs_${tag}_r`; await bind(pay, sid);
  await handleStripeEvent({ id: `evt_r1_${tag}`, type: 'checkout.session.completed', data: { object: { id: sid, payment_status: 'paid', payment_intent: `pi_r_${tag}` } } });
  assert.equal(await handleStripeEvent({ id: `evt_r2_${tag}`, type: 'charge.refunded', data: { object: { payment_intent: `pi_r_${tag}` } } }), 'processed');
  assert.equal((await q('select status from payments where id=$1', [pay]))[0].status, 'refunded');
  assert.equal((await getWallet(u)).available, 50, 'без автоматично изтегляне');
  assert.ok((await q("select 1 from audit_logs where action='payment_refunded_needs_review' and metadata->>'paymentId'=$1", [pay])).length);
  void tx; void creditOp;
});
