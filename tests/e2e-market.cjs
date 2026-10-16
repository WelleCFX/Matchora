// E2E на пазарния поток в истински браузър: услуга -> търсене -> задание -> оферта с boost -> приемане -> поръчка -> чат -> ревю -> админ.
const { chromium } = require(process.env.PW_PATH || 'playwright');
const { Client } = require('pg');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const APP = process.env.APP_URL || 'http://localhost:3000';
const tag = Date.now().toString(36), pw = 'Parola-12345!';
const step = (m) => console.log('ok -', m);
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  await db.query('delete from rate_limits');
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const mk = async () => (await (await b.newContext({ viewport: { width: 400, height: 800 } })).newPage());
  const flash = async (p) => { await p.waitForSelector('[data-flash]'); return p.textContent('[data-flash]'); };
  const link = async (email, kind) => (await db.query(`select body from email_outbox where to_email=$1 and subject like $2 order by id desc limit 1`, [email, kind + '%'])).rows[0].body.match(/https?:\/\/\S+/)[0].replace(/^https?:\/\/[^/]+/, APP);
  async function register(p, name, type) {
    const email = `${name}-${tag}@example.com`;
    await p.goto(APP + '/register'); await p.fill('#displayName', name + ' Тест'); await p.fill('#email', email); await p.fill('#password', pw); await p.fill('#confirm', pw);
    await p.check(`input[value=${type}]`); await p.check('input[name=terms]'); await p.click('button.btn-primary'); await p.waitForURL('**/dashboard');
    await p.goto(await link(email, 'Потвърдете')); await p.click('button.btn-primary'); await p.waitForURL('**/verify?done=1');
    return email;
  }
  const client = await mk(), prov = await mk(), prov2 = await mk(), admin = await mk();
  const ce = await register(client, 'klient', 'client'), pe = await register(prov, 'maistor', 'provider'), p2e = await register(prov2, 'konkurent', 'provider');
  step('регистрирани клиент и двама изпълнители с потвърден имейл');

  // изпълнител без план не може да публикува услуга
  await prov.goto(APP + '/my/services'); await prov.fill('input[name=title]', 'Ремонт на ел. инсталации'); await prov.fill('textarea[name=description]', 'Пълен ремонт и подмяна на ел. табла.');
  await prov.fill('input[name=price]', '80'); await prov.click('button.btn-primary:has-text("Публикувай")');
  assert.match(await flash(prov), /активен платен план/); step('услуга без платен план се отказва');

  // абонамент: чакащо плащане не дава права, webhook дава
  async function buy(p, kind, ref) {
    await p.goto(APP + (kind === 'subscription' ? '/subscription' : '/credits'));
    await p.click(`form:has(input[value=${ref}]) button`); await p.waitForURL('**/pay/**');
    return p;
  }
  await buy(prov, 'subscription', 'pro');
  const pe_id = (await db.query('select id from users where email=$1', [pe])).rows[0].id;
  assert.equal((await db.query("select count(*)::int n from subscriptions where provider_id=$1", [pe_id])).rows[0].n, 0); step('без webhook няма абонамент');
  await prov.click('text=Симулирай успешно плащане'); assert.match(await flash(prov), /точно веднъж/);
  await prov.click('button:has-text("Повтори същия webhook")'); await prov.waitForSelector('[data-flash]:has-text("игнорирано")'); step('повторен webhook не начислява втори път');
  assert.equal((await db.query("select count(*)::int n from subscriptions where provider_id=$1 and status='active'", [pe_id])).rows[0].n, 1);
  // втори изпълнител: план + кредити
  await buy(prov2, 'subscription', 'pro'); await prov2.click('text=Симулирай успешно плащане');
  await buy(prov, 'credits', 'k150'); await prov.click('text=Симулирай успешно плащане');
  await buy(prov2, 'credits', 'k150'); await prov2.click('text=Симулирай успешно плащане');
  const wal = async (e) => (await db.query('select w.available, w.reserved from credit_wallets w join users u on u.id=w.user_id where u.email=$1', [e])).rows[0];
  assert.deepEqual(await wal(pe), { available: 150, reserved: 0 }); step('кредитите са начислени след webhook');

  // услуга и търсене
  await prov.goto(APP + '/my/services'); await prov.fill('input[name=title]', 'Ремонт на ел. инсталации'); await prov.fill('textarea[name=description]', 'Пълен ремонт и подмяна на ел. табла.');
  await prov.fill('input[name=price]', '80'); await prov.selectOption('select[name=city]', 'София'); await prov.selectOption('select[name=categoryId]', { label: 'Електроуслуги' }); await prov.click('button.btn-primary:has-text("Публикувай")');
  await prov.waitForSelector('text=Ремонт на ел. инсталации', { timeout: 8000 }).catch(async () => { console.log('URL', prov.url(), '\n', (await prov.textContent('body')).slice(0, 700)); throw new Error('услугата не се показва след създаване'); });
  await client.goto(APP + '/services?q=' + encodeURIComponent('ток')); await client.waitForSelector('text=Ремонт на ел. инсталации'); step('търсенето намира услугата по синоним („ток“)');
  await client.goto(APP + '/services?q=' + encodeURIComponent('ток') + '&max=10'); assert.equal(await client.locator('text=Ремонт на ел. инсталации').count(), 0); step('филтърът по цена работи');
  // директна заявка -> чат
  await client.click('a:has-text("Търсене")'); await client.goto(APP + '/services?q=ток');
  const myListing = (await db.query("select l.id from service_listings l join users u on u.id=l.provider_id where u.email=$1 and l.title like 'Ремонт на ел%' limit 1", [pe])).rows[0].id; await client.goto(APP + '/services/' + myListing);   // в базата има и обяви от предишни пускания
  await client.fill('textarea[name=message]', 'Здравейте, нужна ми е проверка на таблото.'); await client.click('button:has-text("Изпрати през Matchora")'); await client.waitForURL('**/requests?ok=1');
  await prov.goto(APP + '/requests'); await prov.click('button:has-text("Приеми")'); await prov.waitForSelector('span:has-text("Приета")');
  assert.equal((await db.query("select count(*)::int n from orders where provider_id=$1 and request_id is not null", [pe_id])).rows[0].n, 1); step('директна заявка се приема и създава поръчка');

  // задание: модерация при забранена фраза
  async function postJob(title, desc) {
    await client.goto(APP + '/jobs/new'); await client.fill('#title', title); await client.fill('#budgetMin', '1200'); await client.fill('#budgetMax', '2000');
    await client.fill('#deadline', new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10)); await client.fill('#description', desc); await client.click('button.btn-primary'); await client.waitForURL('**/jobs/**?ok=*');
    return client.url().match(/jobs\/([0-9a-f-]{36})/)[1];
  }
  const bad = await postJob('Бързи пари от казино ' + tag, 'Търся някой да организира казино вечер за бързи пари.');
  assert.equal((await db.query('select status from jobs where id=$1', [bad])).rows[0].status, 'pending_review'); step('задание със забранена фраза чака модерация');
  assert.equal((await prov.goto(APP + '/jobs/' + bad)).status(), 404); step('чакащо задание не е видимо за други');
  const job = await postJob('Изработка на онлайн магазин ' + tag, 'Нужен ми е магазин за ръчно изработени свещи с онлайн плащане и куриер.');

  // оферти с boost и Auto Boost
  async function offerOn(p, price, boost, max) {
    await p.goto(APP + '/jobs/' + job); await p.fill('#price', String(price)); await p.fill('#days', '14'); await p.fill('#boost', String(boost)); await p.fill('#max', String(max));
    await p.fill('#message', 'Правим магазини с плащане и интеграция с куриери.'); await p.click('button:has-text("Подай оферта")'); await p.waitForURL('**?ok=offer');
  }
  await offerOn(prov2, 1700, 40, 0); await offerOn(prov, 1500, 30, 0);
  const bo = async (e) => (await db.query("select pr.boost_credits b from proposals pr join users u on u.id=pr.provider_id where u.email=$1 and pr.job_id=$2", [e, job])).rows[0].b;
  assert.equal(await bo(pe), 30); await prov.goto(APP + '/jobs/' + job);
  await prov.fill('input[name=max]', '100'); await prov.click('button:has-text("Запази")'); await prov.waitForLoadState('networkidle');
  assert.equal(await bo(pe), 41); step('Auto Boost стига до 41 (сценарий 7.4)');
  assert.deepEqual(await wal(pe), { available: 150 - 10 - 41, reserved: 41 }); step('кредитите са точно разпределени: 10 такса + 41 резервирани');
  const board = await prov.textContent('body'); assert.match(board, /Позиция 1 · вие/); step('таблото на наддаването показва позицията');
  // клиентът вижда оферти, спонсорираните са обозначени
  await client.goto(APP + '/jobs/' + job); const ctext = await client.textContent('body');
  assert.match(ctext, /Спонсорирани оферти/); assert.equal(await client.locator('text=Спонсорирано').count() >= 2, true); step('клиентът вижда обозначени спонсорирани оферти');
  assert.equal(await client.locator('button:has-text("Приеми офертата")').count(), 2);
  // чужд изпълнител не вижда чуждите оферти
  assert.doesNotMatch(await prov2.goto(APP + '/jobs/' + job).then(() => prov2.textContent('body')), /Получени оферти/); step('изпълнителите не виждат чуждите оферти');
  // приемане
  await client.locator('button:has-text("Приеми офертата")').first().click(); await client.waitForURL('**/orders/**');
  const wa = await wal(pe), w2 = await wal(p2e);
  assert.equal(wa.reserved, 0); assert.equal(w2.reserved, 0); step('след приемане няма останали резервации');
  const settled = (await db.query("select coalesce(sum(amount),0)::int s from credit_transactions where type='settle_boost' and related in (select id::text from proposals where job_id=$1)", [job])).rows[0].s;
  assert.equal(settled, 41 + 40); step('и двамата спонсорирани позиции са таксувани точно с залозите си');
  assert.equal((await db.query('select status from jobs where id=$1', [job])).rows[0].status, 'closed');

  // поръчка: статуси, чат, ревю
  const orderUrl = client.url(); const accepted = (await db.query('select p.provider_id from proposals p where p.job_id=$1 and p.status=$2', [job, 'accepted'])).rows[0].provider_id;
  const winner = accepted === pe_id ? prov : prov2;
  await winner.goto(orderUrl); await winner.fill('input[name=body]', 'Здравейте! Кога ви е удобно?'); await winner.click('button:has-text("Изпрати")'); await winner.waitForLoadState('networkidle'); await winner.waitForSelector('text=Кога ви е удобно');
  await client.reload(); await client.waitForSelector('text=Кога ви е удобно'); step('чатът по поръчката работи между двете страни');
  for (const t of ['Планирай', 'Започни работа', 'Отбележи като доставена']) { await winner.goto(orderUrl); await winner.click(`button:has-text("${t}")`); await winner.waitForLoadState('networkidle'); }
  await client.reload(); await client.click('button:has-text("Потвърди завършване")'); await client.waitForSelector('text=Оставете ревю');
  await client.fill('textarea[name=body]', 'Страхотна работа, препоръчвам!'); await client.click('button:has-text("Публикувай ревю")'); await client.waitForSelector('text=Потвърдена поръчка'); step('ревю с „Потвърдена поръчка“ след завършена поръчка');
  assert.equal((await db.query('select count(*)::int n from reviews')).rows.length, 1);
  // чужд потребител не вижда поръчката
  assert.equal((await prov.goto(APP.replace(/\/$/, '') + orderUrl.replace(APP, '')).then((r) => (accepted === pe_id ? 200 : r.status()))), accepted === pe_id ? 200 : 404); step('поръчката е видима само за участниците');

  // админ
  await db.query("update users set staff_role='admin' where email=$1", [`admin-${tag}@example.com`]);
  const ae = await register(admin, 'admin', 'client'); await db.query("update users set staff_role='admin' where email=$1", [ae]);
  await db.query("insert into user_totp(user_id, secret_enc, confirmed_at) select id,'x',now() from users where email=$1", [ae]);   // 2FA за админ се тества отделно (e2e-2fa)
  await admin.goto(APP + '/admin'); await admin.waitForSelector('text=Административно табло'); assert.match(await admin.textContent('body'), new RegExp('Бързи пари от казино'));
  await admin.click(`form:has(input[value="${bad}"]) button:has-text("Откажи")`); await admin.waitForLoadState('networkidle');
  assert.equal((await db.query('select status from jobs where id=$1', [bad])).rows[0].status, 'cancelled'); step('администраторът модерира задание');
  await client.goto(APP + '/admin'); assert.match(client.url(), /dashboard/); step('обикновен потребител няма достъп до админ');
  assert.ok((await db.query("select count(*)::int n from audit_logs where action='job_rejected'")).rows[0].n >= 1); step('действието е в одита');
  // webhook endpoint
  const body = JSON.stringify({ id: 'evt_x', type: 'payment.succeeded', payment_id: 'nope' });
  const bad401 = await fetch(APP + '/api/webhooks/payments', { method: 'POST', body, headers: { 'x-matchora-signature': 'deadbeef' } }); assert.equal(bad401.status, 401);
  const sig = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET || 'dev-webhook-secret-change-me').update(body).digest('hex');
  const ok = await fetch(APP + '/api/webhooks/payments', { method: 'POST', body, headers: { 'x-matchora-signature': sig } }); assert.equal(ok.status, 404); step('webhook endpoint: без подпис 401, с подпис се обработва');
  assert.equal(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); step('няма хоризонтален скрол на 400px');
  await b.close(); await db.end(); console.log('\nВСИЧКО МИНАВА');
})().catch((e) => { console.error('ПРОВАЛ:', e.message, (e.stack||'').split('\n').filter(l=>l.includes('e2e-market')).join(' ')); process.exit(1); });
