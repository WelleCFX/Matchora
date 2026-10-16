import type { PoolClient } from 'pg';
import { q, tx } from './db';
import { newToken, audit } from './auth';
import { sendMail } from './mail';
import { BidError } from './bids';
import { createHash } from 'node:crypto';

export type Perm = 'services' | 'requests';
export const PERMS: Perm[] = ['services', 'requests'];
export const PERM_BG: Record<Perm, string> = { services: 'Управление на услуги', requests: 'Отговор на заявки' };

/** Валидира български ЕИК/БУЛСТАТ (9 или 13 цифри) по официалния алгоритъм с контролни цифри. */
export function validEik(v: string): boolean {
  if (!/^(\d{9}|\d{13})$/.test(v)) return false;
  const d = [...v].map(Number);
  const chk = (digits: number[], w1: number[], w2: number[], expected: number) => {
    let r = digits.reduce((s, x, i) => s + x * w1[i], 0) % 11;
    if (r === 10) { r = digits.reduce((s, x, i) => s + x * w2[i], 0) % 11; if (r === 10) r = 0; }
    return r === expected;
  };
  if (!chk(d.slice(0, 8), [1, 2, 3, 4, 5, 6, 7, 8], [3, 4, 5, 6, 7, 8, 9, 10], d[8])) return false;
  if (v.length === 9) return true;
  return chk(d.slice(8, 12), [2, 7, 3, 5], [4, 9, 5, 7], d[12]);
}

export async function createCompany(userId: string, i: { legalName: string; eik: string; vat?: string; address?: string }) {
  const eik = i.eik.replace(/\s/g, ''), vat = i.vat?.replace(/\s/g, '').toUpperCase() || null;
  if (i.legalName.trim().length < 2) throw new BidError('Въведете фирмено наименование');
  if (!validEik(eik)) throw new BidError('Невалиден ЕИК/БУЛСТАТ (9 или 13 цифри с вярна контролна цифра)');
  if (vat && !/^BG\d{9,10}$/.test(vat)) throw new BidError('ДДС номерът трябва да е във формат BG123456789');
  try {
    const id = (await q('insert into companies(owner_id,legal_name,eik,vat_number,address) values ($1,$2,$3,$4,$5) returning id', [userId, i.legalName.trim(), eik, vat, i.address?.trim() || null]))[0].id as string;
    await q("insert into provider_profiles(user_id, verification_status) values ($1,'pending') on conflict (user_id) do update set verification_status = 'pending'", [userId]);
    await q('update provider_profiles set business_name=$2 where user_id=$1', [userId, i.legalName.trim()]);
    await audit(userId, 'company_created', { companyId: id });
    return id;
  } catch (e: any) {
    if (e.code === '23505') throw new BidError(e.constraint?.includes('eik') ? 'Този ЕИК вече е регистриран в Matchora' : 'Вече имате фирмен профил');
    throw e;
  }
}

/** Промяна на данни, определящи самоличността на фирмата, връща проверката в „чака“. */
export async function updateCompany(userId: string, i: { legalName: string; vat?: string; address?: string }) {
  const c = (await q('select * from companies where owner_id=$1', [userId]))[0]; if (!c) throw new BidError('Нямате фирмен профил');
  const vat = i.vat?.replace(/\s/g, '').toUpperCase() || null;
  if (vat && !/^BG\d{9,10}$/.test(vat)) throw new BidError('ДДС номерът трябва да е във формат BG123456789');
  const identityChanged = i.legalName.trim() !== c.legal_name || vat !== c.vat_number;
  await q(`update companies set legal_name=$2, vat_number=$3, address=$4, verification_status = case when $5 then 'pending' else verification_status end where id=$1`, [c.id, i.legalName.trim(), vat, i.address?.trim() || null, identityChanged]);
  await q('update provider_profiles set business_name=$2, verification_status = case when $3 then \'pending\' else verification_status end where user_id=$1', [userId, i.legalName.trim(), identityChanged]);
}

export async function reviewCompany(staffId: string, companyId: string, approve: boolean, note: string) {
  if (!approve && note.trim().length < 3) throw new BidError('Посочете причина за отказа');
  await tx(async (c) => {
    const r = (await c.query("update companies set verification_status=$2, review_note=$3, reviewed_by=$4 where id=$1 and verification_status='pending' returning owner_id", [companyId, approve ? 'verified' : 'rejected', approve ? null : note.trim(), staffId])).rows[0];
    if (!r) throw new BidError('Фирмата не чака проверка');
    await c.query('update provider_profiles set verification_status=$2 where user_id=$1', [r.owner_id, approve ? 'verified' : 'rejected']);
    await c.query("insert into notifications(user_id,type,title,link) values ($1,'company_review',$2,'/company')", [r.owner_id, approve ? 'Фирмата ви е потвърдена' : 'Фирмата ви не е потвърдена']);
  });
  await audit(staffId, approve ? 'company_verified' : 'company_rejected', { companyId });
}

const th = (raw: string) => createHash('sha256').update(raw).digest();

export async function invite(ownerId: string, email: string, perms: string[]) {
  const c = (await q('select * from companies where owner_id=$1', [ownerId]))[0]; if (!c) throw new BidError('Нямате фирмен профил');
  const e = email.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new BidError('Невалиден имейл');
  const p = perms.filter((x): x is Perm => (PERMS as string[]).includes(x)); if (!p.length) throw new BidError('Изберете поне едно право');
  const owner = (await q('select email from users where id=$1', [ownerId]))[0];
  if (owner.email === e) throw new BidError('Вие сте собственик на фирмата');
  if ((await q('select count(*)::int n from company_members where company_id=$1', [c.id]))[0].n + (await q('select count(*)::int n from company_invites where company_id=$1 and expires_at>now()', [c.id]))[0].n >= 10) throw new BidError('Максимум 10 членове и покани');
  const t = newToken();
  await q('delete from company_invites where company_id=$1 and email=$2', [c.id, e]);
  await q("insert into company_invites(company_id,email,perms,token_hash,expires_at) values ($1,$2,$3,$4, now()+interval '7 days')", [c.id, e, p, t.hash]);
  await sendMail(e, `Покана за екипа на ${c.legal_name} в Matchora`, `Поканени сте да работите от името на „${c.legal_name}“ в Matchora.\n\nПриемете поканата (трябва да сте влезли с този имейл): ${process.env.APP_URL}/company/join?token=${t.raw}\n\nПоканата важи 7 дни.`);
}

export async function acceptInvite(userId: string, userEmail: string, raw: string) {
  return tx(async (c: PoolClient) => {
    const inv = (await c.query('select * from company_invites where token_hash=$1 and expires_at>now() for update', [th(raw)])).rows[0];
    if (!inv) throw new BidError('Поканата е невалидна или е изтекла');
    if (inv.email !== userEmail.toLowerCase()) throw new BidError('Поканата е за друг имейл адрес');
    const co = (await c.query('select owner_id, legal_name from companies where id=$1', [inv.company_id])).rows[0];
    if (co.owner_id === userId) throw new BidError('Вие сте собственик на фирмата');
    await c.query('insert into company_members(company_id,user_id,perms) values ($1,$2,$3) on conflict (company_id,user_id) do update set perms=excluded.perms', [inv.company_id, userId, inv.perms]);
    await c.query('delete from company_invites where id=$1', [inv.id]);
    await c.query("insert into notifications(user_id,type,title,link) values ($1,'member_joined','Нов член в екипа на фирмата','/company')", [co.owner_id]);
    return co.legal_name as string;
  });
}

export async function removeMember(ownerId: string, memberId: string) {
  const r = await q('delete from company_members m using companies c where c.id=m.company_id and c.owner_id=$1 and m.user_id=$2 returning m.user_id', [ownerId, memberId]);
  if (!r.length) throw new BidError('Членът не е намерен');
}
export async function updateMemberPerms(ownerId: string, memberId: string, perms: string[]) {
  const p = perms.filter((x): x is Perm => (PERMS as string[]).includes(x));
  const r = await q('update company_members m set perms=$3 from companies c where c.id=m.company_id and c.owner_id=$1 and m.user_id=$2 returning m.user_id', [ownerId, memberId, p]);
  if (!r.length) throw new BidError('Членът не е намерен');
}

/** Идентификаторите на изпълнителите, от чието име потребителят може да действа с дадено право (първо собственото му id). */
export async function providerIdsFor(userId: string, perm: Perm): Promise<string[]> {
  const rows = await q('select c.owner_id from company_members m join companies c on c.id=m.company_id where m.user_id=$1 and $2 = any(m.perms)', [userId, perm]);
  return [userId, ...rows.map((r: any) => r.owner_id as string)];
}
export async function canActFor(userId: string, providerId: string, perm: Perm): Promise<boolean> {
  return (await providerIdsFor(userId, perm)).includes(providerId);
}
