import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../lib/env';
loadEnv();
import { pool, q, tx } from '../lib/db';
import { creditOp, getWallet } from '../lib/credits';
import { createCampaign, getSponsored, recordAdEvent, reviewCampaign, stopCampaign, togglePause } from '../lib/ads';
import { BidError } from '../lib/bids';

after(async () => { await pool().end(); });
const tag = randomUUID().slice(0, 8), UA = 'Mozilla/5.0 (iPhone) Safari', today = () => new Date().toISOString().slice(0, 10);
async function prov(credits = 100, plan = true) {
  const id = (await q('insert into users(email,password_hash,email_verified_at,is_provider) values ($1,$2,now(),true) returning id', [`ad-${tag}-${randomUUID().slice(0, 5)}@t.test`, 'x']))[0].id as string;
  await q('insert into profiles(user_id,display_name) values ($1,$2)', [id, 'Рекламодател']);
  if (plan) await q("insert into subscriptions(provider_id,plan_id,status,period_end) values ($1,'pro','active',now()+interval '30 days')", [id]);
  if (credits) await tx((c) => creditOp(c, { userId: id, type: 'purchase', amount: credits, key: `s:${id}`, actor: null }));
  const lid = (await q(`insert into service_listings(provider_id,category_id,title,description,price_type,price_cents,city) values ($1,(select id from categories where slug='elektro'),'Реклама тест '||$2,'Описание за рекламна услуга','fixed',5000,'София') returning id`, [id, id.slice(0, 6)]))[0].id as string;
  return { id, lid };
}
const camp = (p: { id: string; lid: string }, o: Partial<{ placement: string; days: number; startsOn: string }> = {}) => tx((c) => createCampaign(c, { providerId: p.id, listingId: p.lid, placement: o.placement ?? 'search', startsOn: o.startsOn ?? today(), days: o.days ?? 3 }));
const staff = async () => (await q("insert into users(email,password_hash,staff_role) values ($1,'x','moderator') returning id", [`mod-${tag}-${randomUUID().slice(0, 5)}@t.test`]))[0].id as string;

test('поръчка: кредитите се таксуват веднага, няма отрицателен баланс, нужен е активен план', async () => {
  const p = await prov(100); const id = await camp(p, { days: 3 });                  // 3 кр./ден × 3
  assert.equal((await getWallet(p.id)).available, 91);
  assert.equal((await q('select status from ad_campaigns where id=$1', [id]))[0].status, 'pending_review');
  const poor = await prov(5); await assert.rejects(camp(poor, { days: 3 }), /Недостатъчно кредити/);
  assert.equal((await getWallet(poor.id)).available, 5); assert.equal((await q('select count(*)::int n from ad_campaigns where provider_id=$1', [poor.id]))[0].n, 0, 'без остатъчна кампания при неуспех');
  await assert.rejects(camp(await prov(100, false)), /активен платен план/);
  await assert.rejects(camp(p, { days: 0 }), BidError); await assert.rejects(camp(p, { days: 31 }), /1 до 30/);
  await assert.rejects(camp(p, { startsOn: '2020-01-01' }), /миналото/);
  const other = await prov(); await assert.rejects(tx((c) => createCampaign(c, { providerId: other.id, listingId: p.lid, placement: 'search', startsOn: today(), days: 1 })), /ваша активна услуга/);
});

test('модерация: докато не е одобрена, не се показва; отказ връща кредитите точно веднъж', async () => {
  const p = await prov(100), m = await staff(); const id = await camp(p, { placement: 'home', days: 2 });  // 10×2
  assert.equal((await getSponsored({ placement: 'home' })).some((a) => a.campaign_id === id), false);
  await tx((c) => reviewCampaign(c, id, m, true, ''));
  assert.equal((await getSponsored({ placement: 'home' })).some((a) => a.campaign_id === id), true);
  await assert.rejects(tx((c) => reviewCampaign(c, id, m, true, '')), /не чака преглед/);
  const id2 = await camp(p, { placement: 'home', days: 1 }); await tx((c) => reviewCampaign(c, id2, m, false, 'Подвеждащо'));
  assert.equal((await getWallet(p.id)).available, 100 - 20);          // втората е върната
  assert.equal((await q("select count(*)::int n from credit_transactions where related=$1 and type='promo_refund'", [id2]))[0].n, 1);
});

test('показване: изтекъл план, пауза или неактивна услуга скриват рекламата; категорията се спазва', async () => {
  const p = await prov(100), m = await staff(); const id = await camp(p, { placement: 'category' }); await tx((c) => reviewCampaign(c, id, m, true, ''));
  const has = async (o: any) => (await getSponsored(o)).some((a) => a.campaign_id === id);
  assert.equal(await has({ placement: 'category', categorySlug: 'elektro' }), true);
  assert.equal(await has({ placement: 'category', categorySlug: 'vik' }), false, 'друга категория');
  assert.equal(await has({ placement: 'category' }), false, 'без избрана категория');
  assert.equal(await has({ placement: 'search', categorySlug: 'elektro' }), false, 'категорийна реклама не е в общото търсене');
  await tx((c) => togglePause(c, id, p.id)); assert.equal(await has({ placement: 'category', categorySlug: 'elektro' }), false); await tx((c) => togglePause(c, id, p.id));
  await q("update service_listings set status='paused' where id=$1", [p.lid]); assert.equal(await has({ placement: 'category', categorySlug: 'elektro' }), false);
  await q("update service_listings set status='active' where id=$1", [p.lid]);
  await q("update subscriptions set period_end=now()-interval '1 day' where provider_id=$1", [p.id]); assert.equal(await has({ placement: 'category', categorySlug: 'elektro' }), false);
});

test('измами: дедупликация по час, ботове и собственикът не се броят', async () => {
  const p = await prov(100), m = await staff(); const id = await camp(p, { placement: 'search' }); await tx((c) => reviewCampaign(c, id, m, true, ''));
  const v = { ip: '10.0.0.1', ua: UA };
  assert.equal(await recordAdEvent(id, 'impression', v), true); assert.equal(await recordAdEvent(id, 'impression', v), false, 'повторно в същия час');
  assert.equal(await recordAdEvent(id, 'impression', { ...v, ip: '10.0.0.2' }), true, 'друг зрител');
  assert.equal(await recordAdEvent(id, 'click', v), true); assert.equal(await recordAdEvent(id, 'click', v), false);
  assert.equal(await recordAdEvent(id, 'impression', { ip: '10.0.0.3', ua: 'Googlebot/2.1' }), false, 'бот');
  assert.equal(await recordAdEvent(id, 'impression', { ip: '10.0.0.4', ua: '' }), false, 'без user-agent');
  assert.equal(await recordAdEvent(id, 'click', { ip: '10.0.0.5', ua: UA, userId: p.id }), false, 'собственикът не надува статистиката');
  const results = await Promise.all(Array.from({ length: 10 }, () => recordAdEvent(id, 'impression', { ip: '10.9.9.9', ua: UA })));
  assert.equal(results.filter(Boolean).length, 1, 'конкурентни дубликати се броят веднъж');
  const row = (await q('select impressions, clicks from ad_campaigns where id=$1', [id]))[0]; assert.deepEqual(row, { impressions: 3, clicks: 1 });
  assert.equal(await recordAdEvent(randomUUID(), 'click', v), false, 'непозната кампания');
});

test('отказ: преди старт връща кредитите, след старт не; чужд потребител не може да спре', async () => {
  const p = await prov(100), m = await staff();
  const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const a = await camp(p, { startsOn: future, days: 2 }); await tx((c) => reviewCampaign(c, a, m, true, ''));
  await assert.rejects(tx((c) => stopCampaign(c, a, (c as any) && (p.id + 'x').slice(0, 0) || (randomUUID()), false)), /не е намерена/);
  await tx((c) => stopCampaign(c, a, p.id, false)); assert.equal((await getWallet(p.id)).available, 100, 'върнати при отказ преди старт');
  const b = await camp(p, { days: 2 }); await tx((c) => reviewCampaign(c, b, m, true, ''));
  await tx((c) => stopCampaign(c, b, p.id, false)); assert.equal((await getWallet(p.id)).available, 94, 'след старт няма връщане');
  await assert.rejects(tx((c) => stopCampaign(c, b, p.id, false)), /приключила/);
  const sum = (await q("select coalesce(sum(case when type='purchase' then amount when type='promo_refund' then amount else -amount end),0)::int s from credit_transactions where user_id=$1", [p.id]))[0].s;
  assert.equal(sum, 94, 'ledger е в съгласие с баланса');
});
