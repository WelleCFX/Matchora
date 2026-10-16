// Интеграционни тестове върху реалната база: кредити, наддаване, плащания, конкурентност, права.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../lib/env';
loadEnv();
import { pool, q, tx } from '../lib/db';
import { creditOp, getWallet } from '../lib/credits';
import { BidError, raiseBoost, setAuto, submitProposal, withdrawProposal } from '../lib/bids';
import { acceptProposal, advanceOrder, cancelJob } from '../lib/jobs';
import { handleWebhook, startCheckout } from '../lib/billing';
import { searchListings } from '../lib/search';

const tag = randomUUID().slice(0, 8);
async function user(name: string, opts: { plan?: boolean; credits?: number } = {}) {
  const id = (await q('insert into users(email,password_hash,email_verified_at,is_provider) values ($1,$2,now(),true) returning id', [`${name}-${tag}@t.test`.toLowerCase(), 'x']))[0].id as string;
  await q('insert into profiles(user_id,display_name) values ($1,$2)', [id, name]);
  await q('insert into provider_profiles(user_id) values ($1)', [id]);
  if (opts.plan !== false) await q("insert into subscriptions(provider_id,plan_id,status,period_end) values ($1,'pro','active',now()+interval '30 days')", [id]);
  if (opts.credits) await tx((c) => creditOp(c, { userId: id, type: 'purchase', amount: opts.credits!, key: `seed:${id}`, actor: null }));
  return id;
}
async function job(clientId: string, title = 'Изработка на онлайн магазин') {
  return (await q(`insert into jobs(client_id,category_id,title,description,city,budget_min_cents,budget_max_cents,deadline) values ($1,(select id from categories limit 1),$2,'Описание на заданието, достатъчно дълго.','София',100000,200000,current_date+10) returning id`, [clientId, title]))[0].id as string;
}
const offer = (jobId: string, providerId: string, boost = 0, max = 0, target = 1) =>
  tx((c) => submitProposal(c, { jobId, providerId, price: 150000, days: 10, message: 'Оферта с достатъчно дълго описание', boost, max, target }));
const boostOf = async (id: string) => (await q('select boost_credits b from proposals where id=$1', [id]))[0].b as number;
/** Инвариант: купени = налични + резервирани + изразходвани, за всеки потребител. */
async function conserved(userId: string, purchased: number) {
  const w = await getWallet(userId);
  const spent = (await q("select coalesce(sum(amount),0)::int s from credit_transactions where user_id=$1 and type in ('debit_application','settle_boost')", [userId]))[0].s;
  assert.equal(w.available + w.reserved + spent, purchased, 'кредитите не се губят и не се създават');
}

before(async () => { await q('select 1'); });
after(async () => { await pool().end(); });

test('ledger: идемпотентност, без отрицателен баланс, само за добавяне', async () => {
  const u = await user('wallet', { credits: 100 });
  assert.equal(await tx((c) => creditOp(c, { userId: u, type: 'purchase', amount: 50, key: `k:${tag}`, actor: null })), 'ok');
  assert.equal(await tx((c) => creditOp(c, { userId: u, type: 'purchase', amount: 50, key: `k:${tag}`, actor: null })), 'dup');
  assert.equal((await getWallet(u)).available, 150);
  await assert.rejects(tx((c) => creditOp(c, { userId: u, type: 'debit_application', amount: 151, key: `d:${tag}`, actor: null })), /Недостатъчен/);
  assert.equal((await getWallet(u)).available, 150);
  await assert.rejects(q('update credit_transactions set amount=1 where user_id=$1', [u]), /само за добавяне/);
  await assert.rejects(q('delete from credit_transactions where user_id=$1', [u]), /само за добавяне/);
  await assert.rejects(q('update credit_wallets set available=-1 where user_id=$1', [u]), /check/i);
});

test('конкурентност: 20 едновременни дебита върху 100 кредита не прехвърлят баланса', async () => {
  const u = await user('race', { credits: 100 });
  const res = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => tx((c) => creditOp(c, { userId: u, type: 'debit_application', amount: 10, key: `race:${tag}:${i}`, actor: null }))));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 10);
  assert.equal((await getWallet(u)).available, 0);
});

test('сценарий 7.4: Auto Boost вдига до 41, не надвишава максимума, не води до минус', async () => {
  const client = await user('client1', { plan: false }), [a, b, c] = await Promise.all([user('Prov A', { credits: 200 }), user('Prov B', { credits: 200 }), user('Prov C', { credits: 200 })]);
  const j = await job(client);
  const pa = await offer(j, a, 40), pc = await offer(j, c, 20);
  const pb = await offer(j, b, 30);
  await tx((cn) => setAuto(cn, pb, b, 100, 1));
  assert.equal(await boostOf(pb), 41);
  assert.equal(await boostOf(pa), 40);
  // A отговаря с 60; Auto Boost на B следва със стъпка и спира на максимума
  await tx((cn) => raiseBoost(cn, pa, a, 60));
  assert.equal(await boostOf(pb), 61);
  await tx((cn) => raiseBoost(cn, pa, a, 120));
  assert.equal(await boostOf(pb), 61, 'над максимума Auto Boost не вдига');
  for (const u of [a, b, c]) assert.ok((await getWallet(u)).available >= 0);
  void pc;
});

test('конкурентно наддаване до един и същ залог: подрежда се без двойно таксуване', async () => {
  const client = await user('client2', { plan: false }), [a, b] = await Promise.all([user('R1', { credits: 100 }), user('R2', { credits: 100 })]);
  const j = await job(client);
  const [pa, pb] = [await offer(j, a, 10), await offer(j, b, 10)];
  await Promise.all([tx((cn) => raiseBoost(cn, pa, a, 30)), tx((cn) => raiseBoost(cn, pb, b, 30))]);
  assert.equal(await boostOf(pa), 30); assert.equal(await boostOf(pb), 30);
  assert.equal((await getWallet(a)).reserved, 30); assert.equal((await getWallet(b)).reserved, 30);
  const order = await q("select id from proposals where job_id=$1 order by boost_credits desc, boost_at asc", [j]);
  assert.equal(order.length, 2);   // детерминистичен tie-break по boost_at
});

test('приемане: settle за победителите в слотовете, освобождаване за останалите; кредитите се запазват', async () => {
  const client = await user('client3', { plan: false });
  const ps = await Promise.all([1, 2, 3, 4].map((i) => user('S' + i, { credits: 100 })));
  const j = await job(client);
  const ids: string[] = [];
  for (const [i, p] of ps.entries()) ids.push(await offer(j, p, [40, 30, 20, 10][i]));   // 4-тият остава извън топ 3
  const orderId = await tx((cn) => acceptProposal(cn, client, ids[3]));
  assert.ok(orderId);
  for (const [i, p] of ps.entries()) {
    const w = await getWallet(p);
    assert.equal(w.reserved, 0, 'няма останали резервации');
    await conserved(p, 100);
    const spent = (await q("select coalesce(sum(amount),0)::int s from credit_transactions where user_id=$1 and type='settle_boost'", [p]))[0].s;
    assert.equal(spent, [40, 30, 20, 0][i], i === 3 ? 'извън топ 3 не се таксува' : 'таксува се спечелената позиция');
  }
  const st = await q('select id, status from proposals where job_id=$1', [j]);
  assert.equal(st.filter((r: any) => r.status === 'accepted').length, 1);
  assert.equal((await q('select status from jobs where id=$1', [j]))[0].status, 'closed');
  assert.equal((await q('select count(*)::int n from orders where job_id=$1', [j]))[0].n, 1);
  await assert.rejects(tx((cn) => acceptProposal(cn, client, ids[0])), BidError, 'затворено задание не приема второ приемане');
});

test('права: чужд клиент не приема оферта; отказ освобождава всички залози', async () => {
  const [owner, other] = await Promise.all([user('own', { plan: false }), user('oth', { plan: false })]);
  const p = await user('prov', { credits: 100 });
  const j = await job(owner); const o = await offer(j, p, 25);
  await assert.rejects(tx((cn) => acceptProposal(cn, other, o)), /Само собственикът/);
  await assert.rejects(tx((cn) => cancelJob(cn, other, j, false)), /Нямате право/);
  assert.equal((await getWallet(p)).reserved, 25);
  await tx((cn) => cancelJob(cn, owner, j, false));
  assert.equal((await getWallet(p)).reserved, 0);
  await conserved(p, 100);
});

test('оферти: една текуща на изпълнител, нужен план, нужни кредити, без собствено задание', async () => {
  const client = await user('client5', { plan: false }), p = await user('P5', { credits: 30 }), noPlan = await user('NP', { plan: false, credits: 100 });
  const j = await job(client);
  await offer(j, p, 0);
  await assert.rejects(offer(j, p, 0), /Вече имате оферта/);
  await assert.rejects(offer(j, noPlan, 0), /активен платен план/);
  const p2 = await user('P6', { credits: 15 });
  await assert.rejects(offer(j, p2, 10), /Недостатъчно кредити/);
  assert.equal((await getWallet(p2)).available, 15, 'неуспешна оферта не оставя дебит');
  assert.equal((await q('select count(*)::int n from proposals where provider_id=$1', [p2]))[0].n, 0);
  await assert.rejects(offer(j, client, 0), /собствено задание/);
  const po = (await q('select id from proposals where provider_id=$1', [p]))[0].id;
  await tx((cn) => withdrawProposal(cn, po, p));
  await offer(j, p, 0).catch(() => assert.fail('след оттегляне може нова оферта (с нова такса)'));
});

test('плащания: webhook е идемпотентен, и конкурентно; права само след плащане', async () => {
  const p = await user('payer', { plan: false });
  const pay = await startCheckout(p, 'credits', 'k150');
  const pp = (await q('select provider_payment_id x from payments where id=$1', [pay]))[0].x;
  assert.equal((await getWallet(p)).available, 0, 'без webhook няма кредити');
  const ev = { id: `evt_${tag}`, type: 'payment.succeeded' as const, payment_id: pp };
  const rs = await Promise.all(Array.from({ length: 6 }, () => handleWebhook(ev)));
  assert.equal(rs.filter((r) => r === 'processed').length, 1);
  assert.equal((await getWallet(p)).available, 150);
  assert.equal(await handleWebhook({ ...ev, id: `evt2_${tag}` }), 'duplicate', 'ново събитие за вече платено плащане не начислява пак');
  assert.equal((await getWallet(p)).available, 150);
  assert.equal(await handleWebhook({ id: 'x', type: 'payment.succeeded', payment_id: 'няма' }), 'unknown');
  assert.equal((await q('select count(*)::int n from invoices where payment_id=$1', [pay]))[0].n, 1);
  const sub = await startCheckout(p, 'subscription', 'pro');
  assert.equal((await q("select count(*)::int n from subscriptions where provider_id=$1", [p]))[0].n, 0);
  await handleWebhook({ id: `evs_${tag}`, type: 'payment.succeeded', payment_id: (await q('select provider_payment_id x from payments where id=$1', [sub]))[0].x });
  assert.equal((await q("select count(*)::int n from subscriptions where provider_id=$1 and status='active'", [p]))[0].n, 1);
});

test('търсене: услугите на изпълнител без действащ план са скрити', async () => {
  const cat = (await q('select id from categories limit 1'))[0].id;
  const word = 'уникалнаб' + tag.replace(/[0-9]/g, 'ц').replace(/[a-z]/g, 'ж');   // чиста кирилица: проверява и локала на базата
  const withPlan = await user('vis1'), without = await user('vis2', { plan: false });
  for (const u of [withPlan, without]) await q(`insert into service_listings(provider_id,category_id,title,description,price_type,price_cents,city) values ($1,$2,$3,'Описание за услугата тук','fixed',5000,'Варна')`, [u, cat, `${word} услуга ${u.slice(0, 4)}`]);
  const r = await searchListings({ q: word });
  assert.equal(r.length, 1);
  await q("update subscriptions set period_end=now()-interval '1 day' where provider_id=$1", [withPlan]);
  assert.equal((await searchListings({ q: word })).length, 0, 'изтекъл план скрива услугите');
  assert.equal((await searchListings({ q: "'; drop table users; --" })).length, 0, 'специални символи в заявката са безопасни');
});

test('поръчка: статусите минават само в разрешения ред и от правилната страна', async () => {
  const client = await user('client9', { plan: false }), p = await user('P9', { credits: 50 });
  const j = await job(client); const o = await offer(j, p, 0);
  const oid = await tx((cn) => acceptProposal(cn, client, o));
  await assert.rejects(tx((cn) => advanceOrder(cn, client, oid, 'scheduled')), /право/);
  await assert.rejects(tx((cn) => advanceOrder(cn, p, oid, 'completed')), /Невалидна/);
  for (const to of ['scheduled', 'in_progress', 'delivered']) await tx((cn) => advanceOrder(cn, p, oid, to));
  await assert.rejects(tx((cn) => advanceOrder(cn, p, oid, 'completed')), /право|Невалидна/);
  await tx((cn) => advanceOrder(cn, client, oid, 'completed'));
  assert.equal((await q('select status from orders where id=$1', [oid]))[0].status, 'completed');
});
