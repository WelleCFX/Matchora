// E2E на 2FA: принудително за персонал, включване през UI, вход с код, повторно ползване, код за възстановяване.
const { chromium } = require(process.env.PW_PATH || 'playwright');
const { Client } = require('pg');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const APP = process.env.APP_URL || 'http://localhost:3000';
const tag = Date.now(), email = `adm2fa-${tag}@example.com`, pw = 'Parola-12345!';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32dec = (s) => { let bits = '', out = []; for (const ch of s.replace(/=+$/, '')) bits += B32.indexOf(ch).toString(2).padStart(5, '0'); for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const totp = (secret, step) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(step)); const h = crypto.createHmac('sha1', b32dec(secret)).update(c).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); };
const now = () => Math.floor(Date.now() / 30000);
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  await db.query('delete from rate_limits');
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const step = (m) => console.log('ok -', m);
  const ctx = await b.newContext({ viewport: { width: 400, height: 800 } }), p = await ctx.newPage();
  await p.goto(APP + '/register'); await p.fill('#displayName', 'Админ Тест'); await p.fill('#email', email); await p.fill('#password', pw); await p.fill('#confirm', pw);
  await p.check('input[name=terms]'); await p.click('button.btn-primary'); await p.waitForURL('**/dashboard');
  const v = (await db.query("select body from email_outbox where to_email=$1 and subject like 'Потвърдете%' order by id desc limit 1", [email])).rows[0].body.match(/https?:\/\/\S+/)[0].replace(/^https?:\/\/[^/]+/, APP);
  await p.goto(v); await p.click('button.btn-primary'); await p.waitForURL('**/verify?done=1');
  await db.query("update users set staff_role='admin' where email=$1", [email]);
  await p.goto(APP + '/admin'); assert.match(p.url(), /\/security/); step('админ без 2FA се пренасочва към /security');
  await p.click('button:has-text("Включи")'); await p.waitForSelector('img[alt^="QR"]');
  const secret = (await p.textContent('p.font-mono')).trim(); assert.match(secret, /^[A-Z2-7]{32}$/); step('показан е QR и тайна');
  assert.equal((await db.query('select confirmed_at from user_totp t join users u on u.id=t.user_id where u.email=$1', [email])).rows[0].confirmed_at, null);
  assert.ok(!(await db.query('select secret_enc from user_totp t join users u on u.id=t.user_id where u.email=$1', [email])).rows[0].secret_enc.includes(secret)); step('тайната е шифрована в базата');
  await p.fill('input[name=code]', '000000'); await p.click('button:has-text("Потвърди и включи")'); await p.waitForSelector('[data-flash]'); assert.match(await p.textContent('[data-flash]'), /код/i); step('грешен код не включва 2FA');
  const used = now(); await p.fill('input[name=code]', totp(secret, used)); await p.click('button:has-text("Потвърди и включи")');
  await p.waitForSelector('.grid.font-mono span'); const codes = await p.$$eval('.grid.font-mono span', (els) => els.map((e) => e.textContent.trim()).filter((t) => /^[0-9A-F]{5}-[0-9A-F]{5}$/.test(t)));
  assert.equal(codes.length, 10); step('2FA е включена, показани са 10 кода за възстановяване');
  await p.goto(APP + '/admin'); await p.waitForSelector('text=Административно табло'); step('след включване админът влиза в таблото');
  await p.click('text=Изход'); await p.waitForURL(APP + '/');
  // вход: парола -> код
  const login = async (page) => { await page.goto(APP + '/login'); await page.fill('#email', email); await page.fill('#password', pw); await page.click('button.btn-primary'); };
  await login(p); await p.waitForURL('**/login/2fa'); await p.goto(APP + '/admin'); assert.match(p.url(), /\/login/); step('след паролата, преди кода, няма сесия');
  await login(p); await p.waitForURL('**/login/2fa');
  await p.fill('input[name=code]', '123456'); await p.click('button.btn-primary'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300); assert.match(p.url(), /2fa/); assert.match(await p.textContent('[data-flash]'), /Невалиден/); step('грешен код при вход се отхвърля');
  // повторно използван стъпков код (същият, с който сме потвърдили настройката) трябва да е отхвърлен
  await p.fill('input[name=code]', totp(secret, used)); await p.click('button.btn-primary'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300); assert.match(p.url(), /2fa/); assert.match(await p.textContent('[data-flash]'), /Невалиден/); step('вече използван код се отхвърля (replay)');
  const fresh = totp(secret, Math.max(now(), used + 1));
  await p.fill('input[name=code]', fresh); await p.click('button.btn-primary'); await p.waitForURL('**/dashboard', { timeout: 8000 }).catch(async (e) => { console.log('DBG', JSON.stringify((await db.query('select last_step from user_totp t join users u on u.id=t.user_id where u.email=$1',[email])).rows), 'used', used, 'now', now(), 'fresh step', Math.max(now(), used + 1)); console.log('URL', p.url(), (await p.textContent('body')).slice(0, 300)); throw e; }); step('валиден нов код -> вход');
  await p.goto(APP + '/admin'); await p.waitForSelector('text=Административно табло');
  await p.click('text=Изход'); await p.waitForURL(APP + '/');
  await login(p); await p.waitForURL('**/login/2fa'); await p.fill('input[name=code]', fresh); await p.click('button.btn-primary'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300); assert.match(p.url(), /2fa/); assert.match(await p.textContent('[data-flash]'), /Невалиден/); step('същият код не важи втори път');
  // код за възстановяване
  await p.fill('input[name=code]', codes[0]); await p.click('button.btn-primary'); await p.waitForURL('**/dashboard'); step('вход с код за възстановяване');
  await p.click('text=Изход'); await p.waitForURL(APP + '/');
  await login(p); await p.waitForURL('**/login/2fa'); await p.fill('input[name=code]', codes[0]); await p.click('button.btn-primary'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300); assert.match(p.url(), /2fa/); assert.match(await p.textContent('[data-flash]'), /Невалиден/); step('кодът за възстановяване е еднократен');
  // лимит на опитите
  for (let i = 0; i < 7 && /2fa/.test(p.url()); i++) { await p.fill('input[name=code]', '11111' + i); await p.click('button.btn-primary'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300); }
  await p.goto(APP + '/login/2fa'); assert.doesNotMatch(p.url(), /2fa/, p.url()); step('след твърде много грешни кода предизвикателството се прекратява');
  await db.end(); await b.close(); console.log('ВСИЧКИ 2FA ТЕСТОВЕ МИНАХА');
})().catch((e) => { console.error('ПРОВАЛ:', e.message); process.exit(1); });
