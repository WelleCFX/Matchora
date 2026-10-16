import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { hash, verify } from '@node-rs/argon2';
import { q, tx } from './db';
import { sendMail } from './mail';

export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-mt_session' : 'mt_session';
const SESSION_DAYS = 30;
const sha = (s: string) => createHash('sha256').update(s).digest();
export const newToken = () => { const raw = randomBytes(32).toString('base64url'); return { raw, hash: sha(raw) }; };

export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
let dummy: Promise<string> | null = null; // изравнява времето при несъществуващ потребител
const dummyHash = () => (dummy ??= hashPassword('dummy-password-for-timing'));

export type SessionUser = {
  id: string; email: string; emailVerified: boolean; staffRole: string; activeMode: 'client' | 'provider';
  isProvider: boolean; twoFactor: boolean; displayName: string; city: string | null; bio: string | null; phone: string | null; phonePublic: boolean;
};

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '127.0.0.1').trim();
}

/** true = лимитът е надвишен. Атомарно броене по прозорец. */
export async function rateLimited(key: string, max: number, windowSec: number): Promise<boolean> {
  const rows = await q<{ hits: number }>(
    `insert into rate_limits(key, window_start) values ($1, to_timestamp(floor(extract(epoch from now())/$2)*$2))
     on conflict (key, window_start) do update set hits = rate_limits.hits + 1 returning hits`, [key, windowSec]);
  return rows[0].hits > max;
}

export async function audit(actorId: string | null, action: string, metadata: object = {}) {
  await q('insert into audit_logs(actor_id, action, metadata) values ($1,$2,$3)', [actorId, action, JSON.stringify(metadata)]);
}

export async function createSession(userId: string) {
  const t = newToken();
  const h = await headers();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await q('insert into sessions(user_id, token_hash, expires_at, user_agent, ip) values ($1,$2,$3,$4,$5)',
    [userId, t.hash, expires, h.get('user-agent')?.slice(0, 300) ?? null, (await clientIp())]);
  (await cookies()).set(SESSION_COOKIE, t.raw, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires });
}

export const getSession = cache(async (): Promise<SessionUser | null> => {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const r = await q(
    `select u.id, u.email, u.email_verified_at, u.staff_role, u.active_mode, u.is_provider, u.status,
            p.display_name, p.city, p.bio, p.phone, p.phone_public,
            exists(select 1 from user_totp t where t.user_id = u.id and t.confirmed_at is not null) two_factor
       from sessions s join users u on u.id = s.user_id join profiles p on p.user_id = u.id
      where s.token_hash = $1 and s.expires_at > now()`, [sha(raw)]);
  const u = r[0];
  if (!u || u.status !== 'active') return null;
  return { id: u.id, email: u.email, emailVerified: !!u.email_verified_at, staffRole: u.staff_role, activeMode: u.active_mode,
    isProvider: u.is_provider, twoFactor: u.two_factor, displayName: u.display_name, city: u.city, bio: u.bio, phone: u.phone, phonePublic: u.phone_public };
});

export async function destroySession() {
  const c = await cookies();
  const raw = c.get(SESSION_COOKIE)?.value;
  if (raw) await q('delete from sessions where token_hash = $1', [sha(raw)]);
  c.delete(SESSION_COOKIE);
}

export async function issueToken(userId: string, purpose: 'verify_email' | 'reset_password', ttlMin: number) {
  const t = newToken();
  await q('delete from auth_tokens where user_id=$1 and purpose=$2 and used_at is null', [userId, purpose]);
  await q('insert into auth_tokens(user_id, purpose, token_hash, expires_at) values ($1,$2,$3, now() + make_interval(mins => $4))', [userId, purpose, t.hash, ttlMin]);
  return t.raw;
}
/** Еднократно използване: атомарно маркира токена и връща потребителя. */
export async function consumeToken(raw: string, purpose: 'verify_email' | 'reset_password'): Promise<string | null> {
  const r = await q<{ user_id: string }>(
    `update auth_tokens set used_at = now() where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now() returning user_id`, [sha(raw), purpose]);
  return r[0]?.user_id ?? null;
}

export async function sendVerification(userId: string, email: string) {
  const token = await issueToken(userId, 'verify_email', 60 * 24);
  await sendMail(email, 'Потвърдете имейла си в Matchora', `Здравейте,\n\nПотвърдете имейла си: ${process.env.APP_URL}/verify?token=${token}\n\nЛинкът важи 24 часа. Ако не сте се регистрирали, игнорирайте това писмо.`);
}

export async function registerUser(i: { email: string; password: string; displayName: string; accountType: 'client' | 'provider' }) {
  const ph = await hashPassword(i.password);
  return tx(async (c) => {
    const u = await c.query(
      `insert into users(email, password_hash, is_provider, active_mode) values ($1,$2,$3,$4) on conflict (email) do nothing returning id`,
      [i.email, ph, i.accountType === 'provider', i.accountType]);
    if (!u.rowCount) return null;
    const id = u.rows[0].id as string;
    await c.query('insert into profiles(user_id, display_name) values ($1,$2)', [id, i.displayName]);
    if (i.accountType === 'provider') await c.query('insert into provider_profiles(user_id) values ($1)', [id]);
    await c.query(`insert into audit_logs(actor_id, action) values ($1,'register')`, [id]);
    return id;
  });
}

const MAX_FAILS = 5, LOCK_MIN = 15;
export async function checkLogin(email: string, password: string): Promise<{ id: string } | { error: 'invalid' | 'locked' | 'suspended' }> {
  const r = await q('select id, password_hash, status, failed_logins, locked_until from users where email=$1', [email]);
  const u = r[0];
  if (!u) { await verify(await dummyHash(), password).catch(() => false); return { error: 'invalid' }; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) return { error: 'locked' };
  const ok = await verify(u.password_hash, password).catch(() => false);
  if (!ok) {
    await q(`update users set failed_logins = failed_logins + 1,
                    locked_until = case when failed_logins + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end where id = $1`, [u.id, MAX_FAILS, LOCK_MIN]);
    return { error: 'invalid' };
  }
  if (u.status !== 'active') return { error: 'suspended' };
  await q('update users set failed_logins = 0, locked_until = null where id = $1', [u.id]);
  return { id: u.id };
}

/* ---- вход на две стъпки: паролата дава само кратък „въпрос“, не сесия ---- */
const CHALLENGE_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-mt_2fa' : 'mt_2fa';
export async function createChallenge(userId: string) {
  const t = newToken(), expires = new Date(Date.now() + 5 * 60e3);
  await q('delete from login_challenges where user_id=$1', [userId]);
  await q('insert into login_challenges(user_id, token_hash, expires_at) values ($1,$2,$3)', [userId, t.hash, expires]);
  (await cookies()).set(CHALLENGE_COOKIE, t.raw, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires });
}
export async function currentChallenge(): Promise<{ id: string; user_id: string; attempts: number } | null> {
  const raw = (await cookies()).get(CHALLENGE_COOKIE)?.value; if (!raw) return null;
  return (await q('select id, user_id, attempts from login_challenges where token_hash=$1 and expires_at>now() and attempts<5', [sha(raw)]))[0] ?? null;
}
export async function bumpChallenge(id: string) { await q('update login_challenges set attempts=attempts+1 where id=$1', [id]); }
export async function endChallenge(id: string) { await q('delete from login_challenges where id=$1', [id]); (await cookies()).delete(CHALLENGE_COOKIE); }
