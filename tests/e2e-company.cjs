// E2E: фирмен профил, невалиден/валиден ЕИК, покана на колега, работа от името на фирмата, проверка от админ, реклама (smoke).
const { chromium } = require(process.env.PW_PATH || 'playwright');
const { Client } = require('pg');
const assert = require('node:assert/strict');
const APP = process.env.APP_URL || 'http://localhost:3000', tag = Date.now(), pw = 'Parola-12345!';
const mkEik = (f) => { const d = [...f].map(Number); let r = d.reduce((s, x, i) => s + x * (i + 1), 0) % 11; if (r === 10) { r = d.reduce((s, x, i) => s + x * (i + 3), 0) % 11; if (r === 10) r = 0; } return f + r; };
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect(); await db.query('delete from rate_limits');
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }); const step = (m) => console.log('ok -', m);
  const mk = async () => (await b.newContext({ viewport: { width: 400, height: 800 } })).newPage();
  const link = async (email, kind) => (await db.query(`select body from email_outbox where to_email=$1 and subject like $2 order by id desc limit 1`, [email, kind + '%'])).rows[0].body.match(/https?:\/\/\S+/)[0].replace(/^https?:\/\/[^/]+/, APP);
  async function reg(p, name, type) {
    const email = `${name}-${tag}@example.com`; await p.goto(APP + '/register'); await p.fill('#displayName', name + ' Тест'); await p.fill('#email', email); await p.fill('#password', pw); await p.fill('#confirm', pw);
    await p.check(`input[value=${type}]`); await p.check('input[name=terms]'); await p.click('button.btn-primary'); await p.waitForURL('**/dashboard');
    await p.goto(await link(email, 'Потвърдете')); await p.click('button.btn-primary'); await p.waitForURL('**/verify?done=1'); return email;
  }
  const flash = async (p) => { await p.waitForSelector('[data-flash]'); return p.textContent('[data-flash]'); };
  const owner = await mk(), mem = await mk(), adm = await mk();
  const oe = await reg(owner, 'sobstvenik', 'provider'), me = await reg(mem, 'kolega', 'client'), ae = await reg(adm, 'adminfirm', 'client');
  await owner.goto(APP + '/company');
  await owner.fill('input[name=legalName]', 'Бързи ремонти ЕООД'); await owner.fill('input[name=eik]', '123456789'); await owner.click('button:has-text("Изпрати за проверка")');
  assert.match(await flash(owner), /Невалиден ЕИК/); step('невалиден ЕИК се отхвърля');
  const eik = mkEik(String(20000000 + Math.floor(Math.random() * 79999999)));
  await owner.fill('input[name=legalName]', 'Бързи ремонти ЕООД'); await owner.fill('input[name=eik]', eik); await owner.click('button:has-text("Изпрати за проверка")');
  await owner.waitForSelector('text=Чака проверка'); step('валиден ЕИК -> фирмата чака проверка');
  // покана
  await owner.fill('input[name=email]', me); await owner.click('button:has-text("Изпрати покана")'); await owner.waitForSelector('text=Изпратена покана'); step('поканата е изпратена');
  await mem.goto(await link(me, 'Покана')); await mem.click('button:has-text("Приеми поканата")'); await mem.waitForURL('**/company');
  assert.match(await mem.innerText('body'), /Член сте на екипа на: Бързи ремонти ЕООД/); step('колегата приема поканата');
  // колегата вижда услугите на фирмата и може да публикува от нейно име (нужен е активен план на собственика)
  const oid = (await db.query('select id from users where email=$1', [oe])).rows[0].id;
  await db.query("insert into subscriptions(provider_id,plan_id,status,period_end) values ($1,'pro','active',now()+interval '30 days')", [oid]);
  await mem.goto(APP + '/my/services'); await mem.fill('input[name=title]', 'Боядисване на стаи ' + tag); await mem.fill('textarea[name=description]', 'Професионално боядисване на жилища и офиси.'); await mem.fill('input[name=price]', '120');
  await mem.selectOption('select[name=providerId]', oid); await mem.click('button:has-text("Публикувай")'); await mem.waitForSelector(`text=Боядисване на стаи ${tag}`);
  assert.equal((await db.query('select provider_id from service_listings where title like $1', ['Боядисване на стаи ' + tag])).rows[0].provider_id, oid); step('колегата публикува услуга от името на фирмата');
  // без право
  await db.query("update company_members set perms='{requests}'"+" where user_id=(select id from users where email=$1)", [me]);
  await mem.goto(APP + '/my/services'); assert.match(mem.url(), /dashboard/); step('без право „услуги“ страницата не е достъпна');
  // админ проверява
  await db.query("update users set staff_role='admin' where email=$1", [ae]); await db.query("insert into user_totp(user_id, secret_enc, confirmed_at) select id,'x',now() from users where email=$1", [ae]);
  await adm.goto(APP + '/admin'); await adm.waitForSelector('text=Фирми за проверка');
  await adm.click(`form:has-text("${eik}") button:has-text("Потвърди")`); await adm.waitForLoadState('networkidle');
  assert.equal((await db.query('select verification_status from provider_profiles where user_id=$1', [oid])).rows[0].verification_status, 'verified'); step('админът потвърждава фирмата');
  await owner.goto(APP + '/company'); await owner.waitForSelector('text=Потвърдена'); step('собственикът вижда статус „Потвърдена“');
  // реклама: поръчка през UI, одобрение, показване като „Спонсорирано“ и таксуване
  await db.query("insert into credit_wallets(user_id, available) values ($1, 0) on conflict do nothing", [oid]);
  await db.query("update credit_wallets set available=available+100 where user_id=$1", [oid]);
  await owner.goto(APP + '/ads'); await owner.selectOption('select[name=placement]', 'home'); await owner.fill('input[name=days]', '2'); await owner.click('button:has-text("Поръчай")');
  await owner.waitForLoadState('networkidle');
  const cmp = (await db.query("select id, cost_credits from ad_campaigns where provider_id=$1", [oid])).rows[0]; assert.ok(cmp, 'кампанията е създадена'); step('кампанията е поръчана през UI');
  await owner.goto(APP + '/'); assert.equal(await owner.locator(`text=Боядисване на стаи ${tag}`).count(), 0); step('неодобрена реклама не се показва');
  await db.query("update ad_campaigns set status='cancelled' where id<>$1 and placement='home'", [cmp.id]);   // остатъци от предишни пускания заемат слотовете
  await adm.goto(APP + '/admin/ads'); await adm.click(`form:has(input[value="${cmp.id}"]) button:has-text("Одобри")`); await adm.waitForLoadState('networkidle');
  await owner.goto(APP + '/'); await owner.waitForSelector(`a[rel~=sponsored]:has-text("Боядисване на стаи ${tag}")`); step('одобрената реклама се показва със знак „Спонсорирано“');
  // HeadlessChrome се филтрира като бот, затова зрителят има мобилен user-agent
  const viewer = await (await b.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', viewport: { width: 400, height: 800 } })).newPage(); await viewer.goto(APP + '/'); await viewer.waitForSelector(`a[rel~=sponsored]:has-text("Боядисване на стаи ${tag}")`);
  const st = (await db.query('select impressions, clicks from ad_campaigns where id=$1', [cmp.id])).rows[0]; assert.ok(st.impressions >= 1); step('показванията се отчитат');
  await viewer.click(`a[rel~=sponsored]:has-text("Боядисване на стаи ${tag}")`); await viewer.waitForURL('**/services/**'); assert.equal((await db.query('select clicks from ad_campaigns where id=$1', [cmp.id])).rows[0].clicks, 1); step('кликът пренасочва към услугата и се отчита');
  await owner.goto(APP + '/ads'); await owner.waitForSelector('h1'); step('страницата за реклами се зарежда');
  assert.ok(!(await owner.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))); step('няма хоризонтален скрол на 400px');
  await db.end(); await b.close(); console.log('ВСИЧКИ ТЕСТОВЕ ЗА ФИРМИ МИНАХА');
})().catch((e) => { console.error('ПРОВАЛ:', e.message, (e.stack || '').split('\n').filter((l) => l.includes('e2e-company')).join(' ')); process.exit(1); });
