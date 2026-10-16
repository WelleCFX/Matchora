'use server';
import { redirect } from 'next/navigation';
import { requireVerified, requireStaff, guarded } from '@/lib/guard';
import { createCompany, updateCompany, invite, acceptInvite, removeMember, updateMemberPerms, reviewCompany } from '@/lib/company';

const s = (f: FormData, k: string) => String(f.get(k) ?? '');
export async function createCompanyAction(f: FormData) {
  const u = await requireVerified();
  return guarded('/company', async () => { await createCompany(u.id, { legalName: s(f, 'legalName'), eik: s(f, 'eik'), vat: s(f, 'vat'), address: s(f, 'address') }); });
}
export async function updateCompanyAction(f: FormData) {
  const u = await requireVerified();
  return guarded('/company', async () => { await updateCompany(u.id, { legalName: s(f, 'legalName'), vat: s(f, 'vat'), address: s(f, 'address') }); });
}
export async function inviteAction(f: FormData) {
  const u = await requireVerified();
  return guarded('/company', async () => { await invite(u.id, s(f, 'email'), f.getAll('perms').map(String)); return '/company?ok=1'; });
}
export async function removeMemberAction(f: FormData) {
  const u = await requireVerified();
  return guarded('/company', async () => { await removeMember(u.id, s(f, 'userId')); });
}
export async function memberPermsAction(f: FormData) {
  const u = await requireVerified();
  return guarded('/company', async () => { await updateMemberPerms(u.id, s(f, 'userId'), f.getAll('perms').map(String)); });
}
export async function joinAction(f: FormData) {
  const u = await requireVerified(); const token = s(f, 'token');
  return guarded(`/company/join?token=${encodeURIComponent(token)}`, async () => { await acceptInvite(u.id, u.email, token); return '/company'; });
}
export async function reviewCompanyAction(f: FormData) {
  const st = await requireStaff('moderator');
  return guarded('/admin', async () => { await reviewCompany(st.id, s(f, 'companyId'), s(f, 'decision') === 'approve', s(f, 'note')); });
}
