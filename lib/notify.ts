import type { PoolClient } from 'pg';
import { q } from './db';
import { sendMail } from './mail';

/** Известие в приложението (в транзакцията). */
export async function notify(c: PoolClient, userId: string, type: string, title: string, link?: string) {
  await c.query('insert into notifications(user_id,type,title,link) values ($1,$2,$3,$4)', [userId, type, title, link ?? null]);
}
/** Имейл след успешна транзакция. Без чувствителни данни в текста. */
export async function emailUser(userId: string, subject: string, link?: string) {
  const u = (await q('select email from users where id=$1', [userId]))[0];
  if (u) await sendMail(u.email, subject, `${subject}\n\n${link ? process.env.APP_URL + link : process.env.APP_URL}\n\nМожете да промените известията от профила си.`);
}
