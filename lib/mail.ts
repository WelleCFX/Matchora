import nodemailer, { type Transporter } from 'nodemailer';
import { q } from './db';

const MAX_ATTEMPTS = 6;
let transport: Transporter | null = null;
let transportUrl = '';
function tp() {
  const url = process.env.SMTP_URL;
  if (!url) return null;
  if (!transport || transportUrl !== url) { transport = nodemailer.createTransport({ url, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000 } as any); transportUrl = url; }
  return transport;
}
const backoffMin = (attempts: number) => Math.min(60, 2 ** attempts);   // 2, 4, 8, ... до 60 мин.

/** Записва писмото в опашката и се опитва да го изпрати веднага. Грешка в SMTP никога не чупи заявката на потребителя. */
export async function sendMail(to: string, subject: string, body: string) {
  const id = (await q('insert into email_outbox(to_email, subject, body) values ($1,$2,$3) returning id', [to, subject, body]))[0].id as number;
  if (!process.env.SMTP_URL) {
    if (process.env.NODE_ENV !== 'production') console.log(`\n[email → ${to}] ${subject}\n${body}\n`);
    return;
  }
  await deliver(id).catch(() => {});
}

async function deliver(id: number) {
  const t = tp(); if (!t) return;
  const m = (await q('select * from email_outbox where id=$1 and sent_at is null', [id]))[0];
  if (!m) return;
  try {
    await t.sendMail({ from: process.env.MAIL_FROM ?? 'Matchora <no-reply@localhost>', to: m.to_email, subject: m.subject, text: m.body });
    await q('update email_outbox set sent_at=now(), last_error=null where id=$1', [id]);
  } catch (e: any) {
    const attempts = m.attempts + 1;
    await q(`update email_outbox set attempts=$2, last_error=$3,
              next_attempt_at = case when $2 >= ${MAX_ATTEMPTS} then 'infinity'::timestamptz else now() + make_interval(mins => $4) end where id=$1`,
      [id, attempts, String(e?.message ?? e).slice(0, 300), backoffMin(attempts)]);
  }
}

/** Повторни опити за неизпратените писма. Вика се от cron (npm run mail:flush или /api/cron/mail). */
export async function flushOutbox(limit = 50): Promise<{ sent: number; failed: number }> {
  if (!process.env.SMTP_URL) return { sent: 0, failed: 0 };
  const rows = await q('select id from email_outbox where sent_at is null and attempts < $2 and next_attempt_at <= now() order by id limit $1', [limit, MAX_ATTEMPTS]);
  let sent = 0, failed = 0;
  for (const r of rows) {
    await deliver(r.id);
    const done = (await q('select sent_at from email_outbox where id=$1', [r.id]))[0].sent_at; done ? sent++ : failed++;
  }
  return { sent, failed };
}
