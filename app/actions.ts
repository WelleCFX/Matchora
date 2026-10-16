'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { q } from '@/lib/db';
import {
  audit, bumpChallenge, checkLogin, clientIp, consumeToken, createChallenge, createSession, currentChallenge, endChallenge, destroySession, getSession, hashPassword,
  issueToken, rateLimited, registerUser, sendVerification,
} from '@/lib/auth';
import { sendMail } from '@/lib/mail';
import { disableTotp, confirmSetup, regenerateCodes, startSetup, totpEnabled, verifySecondFactor } from '@/lib/twofactor';
import { cookies } from 'next/headers';
import { verify as verifyHash } from '@node-rs/argon2';
import { firstError, loginSchema, profileSchema, providerSchema, registerSchema, resetSchema, email as emailSchema } from '@/lib/validation';

const go = (path: string, e: string): never => redirect(`${path}?e=${encodeURIComponent(e)}`);
const obj = (f: FormData) => Object.fromEntries(f.entries());

export async function registerAction(f: FormData) {
  if (await rateLimited(`reg:${await clientIp()}`, 10, 3600)) go('/register', 'Твърде много опити. Опитайте по-късно.');
  const p = registerSchema.safeParse(obj(f));
  if (!p.success) return go('/register', firstError(p.error));
  const id = await registerUser(p.data);
  if (!id) return go('/register', 'Този имейл вече е регистриран. Влезте или възстановете паролата.');
  await sendVerification(id, p.data.email);
  await createSession(id);
  redirect('/dashboard');
}

export async function loginAction(f: FormData) {
  const ip = await clientIp();
  if (await rateLimited(`login:${ip}`, 30, 900)) go('/login', 'Твърде много опити. Опитайте след 15 минути.');
  const p = loginSchema.safeParse(obj(f));
  if (!p.success) return go('/login', 'Невалиден имейл или парола');
  if (await rateLimited(`login:${p.data.email}`, 10, 900)) go('/login', 'Твърде много опити. Опитайте след 15 минути.');
  const r = await checkLogin(p.data.email, p.data.password);
  if ('error' in r) {
    return go('/login', r.error === 'locked' ? 'Акаунтът е временно заключен след неуспешни опити. Опитайте след 15 минути.'
      : r.error === 'suspended' ? 'Акаунтът е спрян. Свържете се с поддръжката.' : 'Невалиден имейл или парола');
  }
  if (await totpEnabled(r.id)) { await createChallenge(r.id); redirect('/login/2fa'); }
  await createSession(r.id);
  await audit(r.id, 'login');
  redirect('/dashboard');
}

export async function twoFactorLoginAction(f: FormData) {
  const ch = await currentChallenge();
  if (!ch) return go('/login', 'Сесията за вход изтече. Влезте отново.');
  if (await rateLimited(`2fa:${await clientIp()}`, 30, 900)) return go('/login/2fa', 'Твърде много опити. Опитайте по-късно.');
  if (await verifySecondFactor(ch.user_id, String(f.get('code') ?? ''))) {
    await endChallenge(ch.id); await createSession(ch.user_id); await audit(ch.user_id, 'login_2fa'); redirect('/dashboard');
  }
  await bumpChallenge(ch.id);
  return go('/login/2fa', 'Невалиден код');
}

export async function logoutAction() { await destroySession(); redirect('/'); }

export async function forgotAction(f: FormData) {
  if (await rateLimited(`forgot:${await clientIp()}`, 5, 3600)) go('/forgot', 'Твърде много заявки. Опитайте по-късно.');
  const p = emailSchema.safeParse(f.get('email'));
  if (p.success) {
    const u = (await q('select id from users where email=$1 and status=\'active\'', [p.data]))[0];
    if (u) {
      const t = await issueToken(u.id, 'reset_password', 60);
      await sendMail(p.data, 'Възстановяване на парола в Matchora', `Задайте нова парола: ${process.env.APP_URL}/reset?token=${t}\n\nЛинкът важи 1 час. Ако не сте го поискали, игнорирайте писмото.`);
      await audit(u.id, 'password_reset_requested');
    }
  }
  redirect('/forgot?sent=1'); // един и същ отговор, независимо дали имейлът съществува
}

export async function resetAction(f: FormData) {
  const p = resetSchema.safeParse(obj(f));
  const token = String(f.get('token') ?? '');
  if (!p.success) return redirect(`/reset?token=${encodeURIComponent(token)}&e=${encodeURIComponent(firstError(p.error))}`);
  const uid = await consumeToken(p.data.token, 'reset_password');
  if (!uid) return go('/forgot', 'Линкът е невалиден или изтекъл. Поискайте нов.');
  await q('update users set password_hash=$2, failed_logins=0, locked_until=null where id=$1', [uid, await hashPassword(p.data.password)]);
  await q('delete from sessions where user_id=$1', [uid]); // излизане от всички устройства
  await audit(uid, 'password_reset');
  redirect('/login?e=' + encodeURIComponent('Паролата е сменена. Влезте с новата.') + '&ok=1');
}

export async function verifyAction(f: FormData) {
  const uid = await consumeToken(String(f.get('token') ?? ''), 'verify_email');
  if (!uid) return go('/verify', 'Линкът е невалиден или изтекъл.');
  await q('update users set email_verified_at = coalesce(email_verified_at, now()) where id=$1', [uid]);
  await audit(uid, 'email_verified');
  redirect('/verify?done=1');
}

export async function resendVerificationAction() {
  const s = await getSession(); if (!s) redirect('/login');
  if (s.emailVerified) redirect('/dashboard');
  if (await rateLimited(`resend:${s.id}`, 3, 3600)) go('/dashboard', 'Може да поискате най-много 3 писма на час.');
  await sendVerification(s.id, s.email);
  redirect('/dashboard?sent=1');
}

export async function switchModeAction(f: FormData) {
  const s = await getSession(); if (!s) redirect('/login');
  const mode = f.get('mode') === 'provider' ? 'provider' : 'client';
  if (mode === 'provider' && !s.isProvider) return go('/dashboard', 'Първо активирайте профил на изпълнител.');
  await q('update users set active_mode=$2 where id=$1', [s.id, mode]);
  revalidatePath('/', 'layout'); redirect('/dashboard');
}

export async function becomeProviderAction() {
  const s = await getSession(); if (!s) redirect('/login');
  await q('update users set is_provider=true, active_mode=\'provider\' where id=$1', [s.id]);
  await q('insert into provider_profiles(user_id) values ($1) on conflict do nothing', [s.id]);
  await audit(s.id, 'became_provider');
  redirect('/profile?ok=1');
}

export async function updateProfileAction(f: FormData) {
  const s = await getSession(); if (!s) redirect('/login');
  const p = profileSchema.safeParse(obj(f));
  if (!p.success) return go('/profile', firstError(p.error));
  const d = p.data;
  await q('update profiles set display_name=$2, city=$3, bio=$4, phone=$5, phone_public=$6, updated_at=now() where user_id=$1', [s.id, d.displayName, d.city, d.bio, d.phone, d.phonePublic]);
  if (s.isProvider) {
    const pp = providerSchema.safeParse(obj(f));
    if (!pp.success) return go('/profile', firstError(pp.error));
    const v = pp.data;
    await q('update provider_profiles set business_name=$2, category=$3, service_area=$4, work_hours=$5, updated_at=now() where user_id=$1', [s.id, v.businessName, v.category, v.serviceArea, v.workHours]);
  }
  revalidatePath('/', 'layout'); redirect('/profile?ok=1');
}

/* ---- настройки за сигурност ---- */
const CODES_COOKIE = 'mt_codes';
async function showCodes(codes: string[]) {
  (await cookies()).set(CODES_COOKIE, codes.join(' '), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/security', maxAge: 300 });
}
export async function startTotpAction() {
  const s = await getSession(); if (!s) redirect('/login');
  await startSetup(s.id, s.email); redirect('/security');
}
export async function confirmTotpAction(f: FormData) {
  const s = await getSession(); if (!s) redirect('/login');
  if (await rateLimited(`totpconfirm:${s.id}`, 10, 900)) return go('/security', 'Твърде много опити.');
  const codes = await confirmSetup(s.id, String(f.get('code') ?? ''));
  if (!codes) return go('/security', 'Невалиден код. Проверете часа на телефона си.');
  await showCodes(codes); redirect('/security');
}
async function checkPassword(userId: string, pw: string) {
  const r = (await q('select password_hash from users where id=$1', [userId]))[0];
  return !!r && (await verifyHash(r.password_hash, pw).catch(() => false));
}
export async function disableTotpAction(f: FormData) {
  const s = await getSession(); if (!s) redirect('/login');
  if (s.staffRole !== 'none') return go('/security', 'Персоналът не може да изключи 2FA.');
  if (!(await checkPassword(s.id, String(f.get('password') ?? ''))) || !(await verifySecondFactor(s.id, String(f.get('code') ?? '')))) return go('/security', 'Грешна парола или код.');
  await disableTotp(s.id); redirect('/security');
}
export async function regenerateCodesAction(f: FormData) {
  const s = await getSession(); if (!s) redirect('/login');
  if (!(await checkPassword(s.id, String(f.get('password') ?? '')))) return go('/security', 'Грешна парола.');
  await showCodes(await regenerateCodes(s.id)); redirect('/security');
}
export async function dismissCodesAction() { (await cookies()).delete(CODES_COOKIE); redirect('/security'); }
