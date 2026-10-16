import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import { loadEnv } from '../lib/env';
loadEnv();
import { q, pool } from '../lib/db';
import { flushOutbox, sendMail } from '../lib/mail';

after(async () => { await pool().end(); });
function sink(port: number) {
  const got: string[] = [];
  const s = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onData(stream, _s, cb) { let d = ''; stream.on('data', (c) => (d += c)); stream.on('end', () => { got.push(d); cb(); }); } });
  return new Promise<{ got: string[]; close: () => Promise<void> }>((res) => s.listen(port, '127.0.0.1', () => res({ got, close: () => new Promise((r) => s.close(() => r())) })));
}

test('SMTP: писмото се изпраща и се маркира като изпратено', async () => {
  const srv = await sink(2526); process.env.SMTP_URL = 'smtp://127.0.0.1:2526';
  const to = `m1-${Date.now()}@example.com`;
  await sendMail(to, 'Тема на писмото', 'Текст на писмото');
  const row = (await q('select sent_at, attempts from email_outbox where to_email=$1', [to]))[0];
  assert.ok(row.sent_at); assert.equal(row.attempts, 0);
  assert.equal(srv.got.length, 1);
  const raw = srv.got[0], body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Текст на писмото');
  await srv.close();
});

test('SMTP: при недостъпен сървър се пази в опашката, не хвърля грешка, и се изпраща при повторен опит', async () => {
  process.env.SMTP_URL = 'smtp://127.0.0.1:2527';          // никой не слуша
  const to = `m2-${Date.now()}@example.com`;
  await sendMail(to, 'Повторен опит', 'Тяло');             // не трябва да хвърли
  let row = (await q('select * from email_outbox where to_email=$1', [to]))[0];
  assert.equal(row.sent_at, null); assert.equal(row.attempts, 1); assert.ok(row.last_error);
  await flushOutbox(); assert.equal((await q('select attempts from email_outbox where id=$1', [row.id]))[0].attempts, 1, 'още не е дошло време за следващ опит');
  const srv = await sink(2527);
  await q('update email_outbox set next_attempt_at=now() where id=$1', [row.id]);
  const r = await flushOutbox(); assert.ok(r.sent >= 1);
  row = (await q('select * from email_outbox where id=$1', [row.id]))[0]; assert.ok(row.sent_at); assert.equal(row.last_error, null);
  await srv.close();
});

test('SMTP: след 6 неуспеха писмото спира да се опитва', async () => {
  process.env.SMTP_URL = 'smtp://127.0.0.1:2528';
  const to = `m3-${Date.now()}@example.com`; await sendMail(to, 'Мъртво', 'Тяло');
  const id = (await q('select id from email_outbox where to_email=$1', [to]))[0].id;
  await q('update email_outbox set attempts=5, next_attempt_at=now() where id=$1', [id]);
  await flushOutbox();
  const row = (await q('select attempts, next_attempt_at from email_outbox where id=$1', [id]))[0];
  assert.equal(row.attempts, 6); assert.equal(String(row.next_attempt_at), 'Infinity');
  assert.equal((await flushOutbox()).failed, 0);
  delete process.env.SMTP_URL;
});
