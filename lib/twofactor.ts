import { createHash, randomBytes } from 'node:crypto';
import { q, tx } from './db';
import { decrypt, encrypt } from './crypto';
import { newSecret, otpauthUri, verifyTotp } from './totp';

const sha = (s: string) => createHash('sha256').update(s).digest();
const norm = (c: string) => c.replace(/[\s-]/g, '').toUpperCase();

export async function totpEnabled(userId: string) {
  return !!(await q('select 1 from user_totp where user_id=$1 and confirmed_at is not null', [userId])).length;
}
/** Започва настройка. Неповторимият секрет е шифрован; докато не е потвърден, не се изисква при вход. */
export async function startSetup(userId: string, email: string) {
  if (await totpEnabled(userId)) throw new Error('2FA вече е включена');
  const secret = newSecret();
  await q(`insert into user_totp(user_id, secret_enc) values ($1,$2) on conflict (user_id) do update set secret_enc=excluded.secret_enc, confirmed_at=null, last_step=0`, [userId, encrypt(secret)]);
  return { secret, uri: otpauthUri(secret, email) };
}
export async function pendingSetup(userId: string, email: string) {
  const r = (await q('select secret_enc from user_totp where user_id=$1 and confirmed_at is null', [userId]))[0];
  if (!r) return null;
  const secret = decrypt(r.secret_enc);
  return { secret, uri: otpauthUri(secret, email) };
}
export function makeRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => { const h = randomBytes(5).toString('hex').toUpperCase(); return `${h.slice(0, 5)}-${h.slice(5)}`; });
}
async function storeCodes(c: { query: Function }, userId: string, codes: string[]) {
  await c.query('delete from recovery_codes where user_id=$1', [userId]);
  for (const code of codes) await c.query('insert into recovery_codes(user_id, code_hash) values ($1,$2)', [userId, sha(norm(code))]);
}
export async function confirmSetup(userId: string, code: string): Promise<string[] | null> {
  return tx(async (c) => {
    const r = (await c.query('select secret_enc from user_totp where user_id=$1 and confirmed_at is null for update', [userId])).rows[0];
    if (!r) return null;
    const step = verifyTotp(decrypt(r.secret_enc), code.trim());
    if (step === null) return null;
    await c.query('update user_totp set confirmed_at=now(), last_step=$2 where user_id=$1', [userId, step]);
    const codes = makeRecoveryCodes(); await storeCodes(c, userId, codes);
    await c.query(`insert into audit_logs(actor_id, action) values ($1,'2fa_enabled')`, [userId]);
    return codes;
  });
}
/** Втори фактор при вход: TOTP (еднократно по стъпка) или код за възстановяване (еднократен). */
export async function verifySecondFactor(userId: string, input: string): Promise<boolean> {
  const code = input.trim();
  if (/^\d{6}$/.test(code)) {
    return tx(async (c) => {
      const r = (await c.query('select secret_enc, last_step from user_totp where user_id=$1 and confirmed_at is not null for update', [userId])).rows[0];
      if (!r) return false;
      const step = verifyTotp(decrypt(r.secret_enc), code);
      if (step === null || step <= Number(r.last_step)) return false;     // повторен код се отхвърля
      await c.query('update user_totp set last_step=$2 where user_id=$1', [userId, step]);
      return true;
    });
  }
  const used = await q('update recovery_codes set used_at=now() where user_id=$1 and code_hash=$2 and used_at is null returning id', [userId, sha(norm(code))]);
  if (used.length) { await q(`insert into audit_logs(actor_id, action) values ($1,'2fa_recovery_code_used')`, [userId]); return true; }
  return false;
}
export async function disableTotp(userId: string) {
  await tx(async (c) => {
    await c.query('delete from user_totp where user_id=$1', [userId]);
    await c.query('delete from recovery_codes where user_id=$1', [userId]);
    await c.query(`insert into audit_logs(actor_id, action) values ($1,'2fa_disabled')`, [userId]);
  });
}
export async function regenerateCodes(userId: string) {
  const codes = makeRecoveryCodes();
  await tx((c) => storeCodes(c, userId, codes));
  return codes;
}
export const remainingCodes = async (userId: string) => (await q('select count(*)::int n from recovery_codes where user_id=$1 and used_at is null', [userId]))[0].n as number;
