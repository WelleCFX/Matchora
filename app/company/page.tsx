import { q } from '@/lib/db';
import { requireVerified } from '@/lib/guard';
import { Flash } from '@/components/Flash';
import { Pill } from '@/components/ui';
import { PERMS, PERM_BG } from '@/lib/company';
import { createCompanyAction, updateCompanyAction, inviteAction, removeMemberAction, memberPermsAction } from '../actions/company';

export const metadata = { title: 'Фирма' };
const ST: Record<string, string> = { pending: 'Чака проверка', verified: 'Потвърдена', rejected: 'Отказана' };
export default async function CompanyPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const u = await requireVerified(); const { e, ok } = await searchParams;
  const c = (await q('select * from companies where owner_id=$1', [u.id]))[0];
  const memberOf = await q('select co.legal_name, m.perms from company_members m join companies co on co.id=m.company_id where m.user_id=$1', [u.id]);
  const members = c ? await q('select m.user_id, m.perms, p.display_name, us.email from company_members m join users us on us.id=m.user_id join profiles p on p.user_id=m.user_id where m.company_id=$1 order by m.created_at', [c.id]) : [];
  const invites = c ? await q('select email, perms, expires_at from company_invites where company_id=$1 and expires_at>now() order by created_at', [c.id]) : [];
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Фирмен профил</h1>
      <Flash error={e} ok={ok ? 'Поканата е изпратена.' : undefined} />
      {memberOf.length > 0 && <div className="card text-sm">Член сте на екипа на: {memberOf.map((m: any) => <span key={m.legal_name} className="mr-2"><b>{m.legal_name}</b> ({m.perms.map((p: string) => PERM_BG[p as keyof typeof PERM_BG]).join(', ')})</span>)}</div>}
      {!c ? (
        <form action={createCompanyAction} className="card space-y-3">
          <p className="text-sm text-slate-600">Регистрирайте фирмата си, за да получите значка „Проверена фирма“ и да добавите екип. Абонаментът и кредитите остават към вашия акаунт.</p>
          <input name="legalName" className="input" placeholder="Фирмено наименование (напр. Бързо ЕООД)" required aria-label="Фирмено наименование" />
          <input name="eik" className="input" placeholder="ЕИК / БУЛСТАТ (9 или 13 цифри)" inputMode="numeric" required aria-label="ЕИК" />
          <input name="vat" className="input" placeholder="ДДС номер (по избор), напр. BG123456789" aria-label="ДДС номер" />
          <input name="address" className="input" placeholder="Адрес на управление" aria-label="Адрес" />
          <button className="btn btn-primary w-full">Изпрати за проверка</button>
        </form>
      ) : (<>
        <form action={updateCompanyAction} className="card space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-semibold">{c.legal_name}</h2><Pill tone={c.verification_status === 'verified' ? 'good' : c.verification_status === 'rejected' ? 'bad' : 'neutral'}>{ST[c.verification_status]}</Pill></div>
          <p className="text-sm text-slate-600">ЕИК {c.eik}{c.review_note ? ` · Причина: ${c.review_note}` : ''}. Промяна на наименованието или ДДС номера налага нова проверка.</p>
          <input name="legalName" className="input" defaultValue={c.legal_name} required aria-label="Фирмено наименование" />
          <input name="vat" className="input" defaultValue={c.vat_number ?? ''} placeholder="ДДС номер" aria-label="ДДС номер" />
          <input name="address" className="input" defaultValue={c.address ?? ''} placeholder="Адрес" aria-label="Адрес" />
          <button className="btn w-full">Запази</button>
        </form>
        <section className="space-y-2"><h2 className="font-display text-lg">Екип</h2>
          {members.map((m: any) => (
            <form key={m.user_id} className="card space-y-2"><input type="hidden" name="userId" value={m.user_id} />
              <p><b>{m.display_name}</b> <span className="text-sm text-slate-600">{m.email}</span></p>
              <div className="flex flex-wrap gap-3 text-sm">{PERMS.map((p) => <label key={p} className="flex items-center gap-1"><input type="checkbox" name="perms" value={p} defaultChecked={m.perms.includes(p)} /> {PERM_BG[p]}</label>)}</div>
              <div className="flex gap-2"><button formAction={memberPermsAction} className="btn !min-h-[40px] text-sm">Запази правата</button><button formAction={removeMemberAction} className="btn !min-h-[40px] text-sm">Премахни</button></div></form>))}
          {invites.map((i: any) => <div key={i.email} className="card text-sm text-slate-600">Изпратена покана до {i.email} (валидна до {new Date(i.expires_at).toLocaleDateString('bg-BG')})</div>)}
          <form action={inviteAction} className="card space-y-3">
            <input name="email" type="email" className="input" placeholder="Имейл на колега (с акаунт в Matchora)" required aria-label="Имейл на колега" />
            <div className="flex flex-wrap gap-3 text-sm">{PERMS.map((p) => <label key={p} className="flex items-center gap-1"><input type="checkbox" name="perms" value={p} defaultChecked /> {PERM_BG[p]}</label>)}</div>
            <button className="btn btn-primary w-full">Изпрати покана</button>
            <p className="text-xs text-slate-500">Членовете не виждат кредитите, плащанията и поръчките ви. Заявките, които приемат, стават ваши поръчки.</p>
          </form>
        </section></>)}
    </div>
  );
}
