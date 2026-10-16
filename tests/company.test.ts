import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../lib/env';
loadEnv();
import { pool, q } from '../lib/db';
import { validEik, createCompany, updateCompany, reviewCompany, invite, acceptInvite, providerIdsFor, canActFor, removeMember, updateMemberPerms } from '../lib/company';

after(async () => { await pool().end(); });
const tag = randomUUID().slice(0, 8);
async function user(prov = true) {
  const email = `co-${tag}-${randomUUID().slice(0, 5)}@t.test`;
  const id = (await q('insert into users(email,password_hash,email_verified_at,is_provider) values ($1,$2,now(),$3) returning id', [email, 'x', prov]))[0].id as string;
  await q('insert into profiles(user_id,display_name) values ($1,$2)', [id, 'Тест']); return { id, email };
}
// Генерира валиден ЕИК за тестовете по същия алгоритъм (независимо от продукционния код).
function mkEik9(first8: string) {
  const d = [...first8].map(Number); let r = d.reduce((s, x, i) => s + x * (i + 1), 0) % 11;
  if (r === 10) { r = d.reduce((s, x, i) => s + x * (i + 3), 0) % 11; if (r === 10) r = 0; } return first8 + r;
}
const uniq8 = () => String(10000000 + Math.floor(Math.random() * 89999999));
const tokenFrom = async (email: string) => { const m = (await q("select body from email_outbox where to_email=$1 order by id desc limit 1", [email]))[0]; return /token=([\w-]+)/.exec(m.body)![1]; };

test('ЕИК: известни валидни/невалидни стойности и контролни цифри', () => {
  assert.equal(validEik('831641791'), true);      // Софийска вода — публично известен ЕИК
  assert.equal(validEik('831641792'), false);
  assert.equal(validEik('12345'), false); assert.equal(validEik('12345678a'), false); assert.equal(validEik(''), false);
  for (let i = 0; i < 20; i++) assert.equal(validEik(mkEik9(uniq8())), true);
  const e9 = mkEik9('20123456'); assert.equal(validEik(e9), true); assert.equal(validEik(e9.slice(0, 8) + ((+e9[8] + 1) % 10)), false);
});

test('създаване: валидация, уникален ЕИК, една фирма на собственик, статус „чака“', async () => {
  const o = await user(); const eik = mkEik9(uniq8());
  await assert.rejects(createCompany(o.id, { legalName: 'А', eik }), /наименование/);
  await assert.rejects(createCompany(o.id, { legalName: 'Тест ЕООД', eik: '123456789' }), /Невалиден ЕИК/);
  await assert.rejects(createCompany(o.id, { legalName: 'Тест ЕООД', eik, vat: 'DE123' }), /ДДС/);
  await createCompany(o.id, { legalName: 'Тест ЕООД', eik, vat: 'bg' + eik });
  const row = (await q('select verification_status, vat_number from companies where owner_id=$1', [o.id]))[0]; assert.deepEqual(row, { verification_status: 'pending', vat_number: 'BG' + eik });
  assert.equal((await q('select verification_status from provider_profiles where user_id=$1', [o.id]))[0].verification_status, 'pending');
  await assert.rejects(createCompany(o.id, { legalName: 'Друга', eik: mkEik9(uniq8()) }), /Вече имате/);
  const o2 = await user(); await assert.rejects(createCompany(o2.id, { legalName: 'Дубъл', eik }), /вече е регистриран/);
});

test('проверка: одобрение, отказ изисква причина, повторно решение е невъзможно, промяна на име връща „чака“', async () => {
  const o = await user(), m = (await q("insert into users(email,password_hash,staff_role) values ($1,'x','moderator') returning id", [`m-${tag}-${randomUUID().slice(0, 4)}@t.test`]))[0].id as string;
  await createCompany(o.id, { legalName: 'Проверка ООД', eik: mkEik9(uniq8()) });
  const cid = (await q('select id from companies where owner_id=$1', [o.id]))[0].id;
  await assert.rejects(reviewCompany(m, cid, false, ''), /причина/);
  await reviewCompany(m, cid, true, '');
  assert.equal((await q('select verification_status from provider_profiles where user_id=$1', [o.id]))[0].verification_status, 'verified');
  await assert.rejects(reviewCompany(m, cid, true, ''), /не чака/);
  await updateCompany(o.id, { legalName: 'Проверка ООД', address: 'София' });   // само адрес — остава потвърдена
  assert.equal((await q('select verification_status from companies where id=$1', [cid]))[0].verification_status, 'verified');
  await updateCompany(o.id, { legalName: 'Ново име ООД' });
  assert.equal((await q('select verification_status from companies where id=$1', [cid]))[0].verification_status, 'pending');
  assert.equal((await q('select verification_status from provider_profiles where user_id=$1', [o.id]))[0].verification_status, 'pending');
});

test('екип: покана, приемане само с правилния имейл, еднократна, права и премахване', async () => {
  const o = await user(), mem = await user(false), other = await user(false);
  await createCompany(o.id, { legalName: 'Екип ЕООД', eik: mkEik9(uniq8()) });
  await assert.rejects(invite(o.id, 'не-имейл', ['services']), /имейл/); await assert.rejects(invite(o.id, mem.email, []), /право/); await assert.rejects(invite(o.id, o.email, ['services']), /собственик/);
  await assert.rejects(invite(mem.id, o.email, ['services']), /нямате фирмен/i);
  await invite(o.id, mem.email, ['services']);
  const t = await tokenFrom(mem.email);
  await assert.rejects(acceptInvite(other.id, other.email, t), /друг имейл/);
  await assert.rejects(acceptInvite(mem.id, mem.email, 'грешен'), /невалидна/);
  assert.equal(await acceptInvite(mem.id, mem.email, t), 'Екип ЕООД');
  await assert.rejects(acceptInvite(mem.id, mem.email, t), /невалидна/, 'токенът е еднократен');
  assert.deepEqual((await providerIdsFor(mem.id, 'services')).sort(), [mem.id, o.id].sort());
  assert.deepEqual(await providerIdsFor(mem.id, 'requests'), [mem.id], 'без право за заявки');
  assert.equal(await canActFor(mem.id, o.id, 'services'), true); assert.equal(await canActFor(other.id, o.id, 'services'), false);
  assert.equal(await canActFor(o.id, mem.id, 'services'), false, 'собственикът на друг акаунт няма достъп обратно');
  await updateMemberPerms(o.id, mem.id, ['requests']); assert.equal(await canActFor(mem.id, o.id, 'services'), false); assert.equal(await canActFor(mem.id, o.id, 'requests'), true);
  await assert.rejects(updateMemberPerms(other.id, mem.id, ['services']), /не е намерен/, 'чужд собственик не може да променя');
  await assert.rejects(removeMember(other.id, mem.id), /не е намерен/);
  await removeMember(o.id, mem.id); assert.equal(await canActFor(mem.id, o.id, 'requests'), false);
});

test('изтекла покана не се приема', async () => {
  const o = await user(), mem = await user(false); await createCompany(o.id, { legalName: 'Изтичане ЕООД', eik: mkEik9(uniq8()) });
  await invite(o.id, mem.email, ['services']); const t = await tokenFrom(mem.email);
  await q("update company_invites set expires_at=now()-interval '1 minute' where email=$1", [mem.email]);
  await assert.rejects(acceptInvite(mem.id, mem.email, t), /невалидна|изтекла/);
});
