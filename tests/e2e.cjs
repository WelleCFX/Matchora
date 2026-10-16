// E2E тест на автентикацията в истински браузър. Изисква работещ сървър на APP_URL и база от DATABASE_URL.
const { chromium } = require(process.env.PW_PATH || 'playwright');
const { Client } = require('pg');
const assert = require('node:assert/strict');
const APP = process.env.APP_URL || 'http://localhost:3000';
const email = `t${Date.now()}@example.com`;
const pw = 'Parola-12345!';
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 400, height: 800 } })).newPage();
  const link = async (kind) => (await db.query(`select body from email_outbox where to_email=$1 and subject like $2 order by id desc limit 1`, [email, kind + '%'])).rows[0].body.match(/https?:\/\/\S+/)[0].replace(/^https?:\/\/[^/]+/, APP);
  const step = (m) => console.log('ok -', m);

  // 1. гост не вижда таблото
  await p.goto(APP + '/dashboard'); assert.match(p.url(), /\/login/); step('таблото пренасочва госта към вход');
  // 2. регистрация: валидации
  await p.goto(APP + '/register');
  await p.fill('#displayName', 'Тест Клиент'); await p.fill('#email', email); await p.fill('#password', pw); await p.fill('#confirm', 'различна-парола-1');
  await p.check('input[name=terms]'); await p.click('button.btn-primary');
  assert.match(await p.waitForSelector('[data-flash]').then(() => p.textContent('[data-flash]')), /Паролите не съвпадат/); step('несъвпадащи пароли се отхвърлят');
  // 3. успешна регистрация
  await p.fill('#displayName', 'Тест Клиент'); await p.fill('#email', email); await p.fill('#password', pw); await p.fill('#confirm', pw);
  await p.check('input[name=terms]'); await p.click('button.btn-primary');
  await p.waitForURL('**/dashboard'); assert.match(await p.innerText('body'), /Потвърдете имейла/); step('регистрация и автоматичен вход');
  const row = (await db.query('select password_hash, email_verified_at from users where email=$1', [email])).rows[0];
  assert.match(row.password_hash, /^\$argon2/); assert.equal(row.email_verified_at, null); step('паролата е argon2, имейлът е непотвърден');
  const sess = (await db.query('select token_hash from sessions s join users u on u.id=s.user_id where u.email=$1', [email])).rows;
  const cookie = (await p.context().cookies()).find((c) => c.name.endsWith('mt_session'));
  assert.ok(cookie.httpOnly && sess.length === 1 && !Buffer.from(sess[0].token_hash).toString('base64url').includes(cookie.value)); step('бисквитката е httpOnly, в базата е само хеш');
  // 4. дублиран имейл
  const ctx2 = await b.newContext(); const p2 = await ctx2.newPage(); await p2.goto(APP + '/register');
  await p2.fill('#displayName', 'Друг'); await p2.fill('#email', email.toUpperCase()); await p2.fill('#password', pw); await p2.fill('#confirm', pw);
  await p2.check('input[name=terms]'); await p2.click('button.btn-primary');
  assert.match(await p2.waitForSelector('[data-flash]').then(() => p2.textContent('[data-flash]')), /вече е регистриран/); step('дублиран имейл (без значение на регистъра) се отхвърля');
  // 5. потвърждение на имейл е POST и еднократно
  const v = await link('Потвърдете'); await p.goto(v);
  assert.equal((await db.query('select email_verified_at from users where email=$1', [email])).rows[0].email_verified_at, null); step('отварянето на линка (GET) не потвърждава сам');
  await p.click('button.btn-primary'); await p.waitForURL('**/verify?done=1');
  assert.ok((await db.query('select email_verified_at from users where email=$1', [email])).rows[0].email_verified_at); step('потвърждението работи');
  await p.goto(v); await p.click('button.btn-primary'); assert.match(await p.waitForSelector('[data-flash]').then(() => p.textContent('[data-flash]')), /невалиден или изтекъл/); step('токенът е еднократен');
  // 6. режими
  await p.goto(APP + '/dashboard'); await p.click('text=Активирай профил на изпълнител'); await p.waitForURL('**/profile?ok=1');
  assert.match(await p.innerText('body'), /Профил на изпълнител/); step('активиране на профил на изпълнител');
  await p.goto(APP + '/profile'); await p.fill('#displayName', 'Тест Майстор'); await p.selectOption('#city', 'Варна'); await p.fill('#businessName', 'Тест ЕООД'); await p.selectOption('#category', 'ВиК'); await p.fill('#phone', '+359 88 123 4567');
  await p.click('button.btn-primary'); await p.waitForURL('**/profile?ok=1');
  const pr = (await db.query('select p.display_name, p.city, p.phone_public, pp.business_name from profiles p join users u on u.id=p.user_id join provider_profiles pp on pp.user_id=u.id where u.email=$1', [email])).rows[0];
  assert.deepEqual(pr, { display_name: 'Тест Майстор', city: 'Варна', phone_public: false, business_name: 'Тест ЕООД' }); step('профилът се запазва, телефонът е скрит по подразбиране');
  // 7. изход / защитен достъп
  await p.click('text=Изход'); await p.waitForURL(APP + '/'); await p.goto(APP + '/profile'); assert.match(p.url(), /\/login/); step('изход унищожава сесията');
  assert.equal((await db.query('select count(*)::int c from sessions s join users u on u.id=s.user_id where u.email=$1', [email])).rows[0].c, 0);
  // 8. грешна парола -> заключване
  for (let i = 0; i < 5; i++) { await p.goto(APP + '/login'); await p.fill('#email', email); await p.fill('#password', 'грешна-парола-' + i); await p.click('button.btn-primary'); }
  await p.goto(APP + '/login'); await p.fill('#email', email); await p.fill('#password', pw); await p.click('button.btn-primary');
  assert.match(await p.waitForSelector('[data-flash]').then(() => p.textContent('[data-flash]')), /заключен/); step('акаунтът се заключва след 5 грешки (дори с вярна парола)');
  await db.query('update users set locked_until=null, failed_logins=0 where email=$1', [email]);
  // 9. забравена парола
  await p.goto(APP + '/forgot'); await p.fill('#email', 'nobody-here@example.com'); await p.click('button.btn-primary'); const msg1 = await p.waitForSelector('[data-flash]').then(() => p.textContent('[data-flash]'));
  await p.goto(APP + '/forgot'); await p.fill('#email', email); await p.click('button.btn-primary'); const msg2 = await p.waitForSelector('[data-flash]').then(() => p.textContent('[data-flash]'));
  assert.equal(msg1, msg2); step('отговорът е еднакъв за съществуващ и несъществуващ имейл');
  const r = await link('Възстановяване'); await p.goto(r); await p.fill('#password', 'Нова-парола-9876'); await p.fill('#confirm', 'Нова-парола-9876'); await p.click('button.btn-primary');
  await p.waitForURL('**/login**'); step('нова парола е зададена');
  await p.goto(r); await p.fill('#password', 'Трета-парола-1111'); await p.fill('#confirm', 'Трета-парола-1111'); await p.click('button.btn-primary');
  assert.match(await p.waitForSelector('[data-flash]').then(() => p.textContent('[data-flash]')), /невалиден или изтекъл/); step('линкът за парола е еднократен');
  await p.goto(APP + '/login'); await p.fill('#email', email); await p.fill('#password', 'Нова-парола-9876'); await p.click('button.btn-primary'); await p.waitForURL('**/dashboard'); step('вход с новата парола');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); step('няма хоризонтален скрол на 400px');
  await b.close(); await db.end(); console.log('\nВСИЧКО МИНАВА');
})().catch((e) => { console.error('ПРОВАЛ:', e.message); process.exit(1); });
