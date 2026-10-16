import { redirect } from 'next/navigation';
import { getSession, type SessionUser } from './auth';
import { BidError } from './bids';
import { CreditError } from './credits';

export async function requireUser(): Promise<SessionUser> {
  const s = await getSession(); if (!s) redirect('/login'); return s;
}
export async function requireVerified(): Promise<SessionUser> {
  const s = await requireUser();
  if (!s.emailVerified) redirect('/dashboard?e=' + encodeURIComponent('Потвърдете имейла си, за да продължите.'));
  return s;
}
export async function requireProvider(): Promise<SessionUser> {
  const s = await requireVerified();
  if (!s.isProvider) redirect('/dashboard?e=' + encodeURIComponent('Нужен е профил на изпълнител.'));
  return s;
}
export async function requireStaff(min: 'support' | 'moderator' | 'admin' = 'moderator'): Promise<SessionUser> {
  const s = await requireUser();
  const order = ['none', 'support', 'moderator', 'admin'];
  if (order.indexOf(s.staffRole) < order.indexOf(min)) redirect('/dashboard');
  // Персоналът работи само с включена 2FA.
  if (!s.twoFactor) redirect('/security?e=' + encodeURIComponent('За достъп до администрацията включете двуфакторна автентикация.'));
  return s;
}
/** Изпълнява действие; бизнес грешките се връщат като съобщение към страницата, останалите се хвърлят. */
export async function guarded(back: string, fn: () => Promise<string | void>): Promise<never> {
  let target: string | void;
  try { target = await fn(); }
  catch (e) {
    if (e instanceof BidError || e instanceof CreditError) redirect(`${back}${back.includes('?') ? '&' : '?'}e=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(target || back);
}
