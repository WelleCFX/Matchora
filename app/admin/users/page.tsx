import { q } from '@/lib/db';
import { requireStaff } from '@/lib/guard';
import { setUserStatusAction, setVerificationAction } from '../../actions/admin';
import { Flash } from '@/components/Flash';
import { Pill } from '@/components/ui';

export const metadata = { title: 'Потребители' };
export default async function Users({ searchParams }: { searchParams: Promise<{ e?: string; s?: string }> }) {
  const st = await requireStaff('support'); const { e, s: search } = await searchParams;
  const rows = await q(`select u.id, u.email, u.status, u.is_provider, u.staff_role, u.email_verified_at, p.display_name, pp.verification_status from users u join profiles p on p.user_id=u.id left join provider_profiles pp on pp.user_id=u.id
     ${search ? "where u.email ilike $1 or p.display_name ilike $1" : ''} order by u.created_at desc limit 50`, search ? [`%${search}%`] : []);
  return (
    <div className="space-y-3"><h1 className="font-display text-2xl">Потребители</h1><Flash error={e} />
      <form className="flex gap-2"><input name="s" defaultValue={search} className="input" placeholder="Имейл или име" aria-label="Търсене" /><button className="btn">Търси</button></form>
      {rows.map((u: any) => <div key={u.id} className="card space-y-2"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{u.display_name}</p><p className="text-sm text-slate-600">{st.staffRole === 'support' ? u.email.replace(/^(.).*(@.*)$/, '$1***$2') : u.email}</p><p className="break-all text-[11px] text-slate-400">{u.id}</p></div>
        <div className="flex flex-col items-end gap-1"><Pill tone={u.status === 'active' ? 'good' : 'bad'}>{u.status === 'active' ? 'Активен' : 'Спрян'}</Pill>{u.is_provider && <Pill>{u.verification_status === 'verified' ? 'Проверен' : 'Непроверен'}</Pill>}</div></div>
        {st.staffRole !== 'support' && <div className="flex flex-wrap gap-2">
          <form action={setUserStatusAction}><input type="hidden" name="userId" value={u.id} />{u.status === 'active' ? <><input type="hidden" name="status" value="suspended" /><button className="btn !min-h-[40px] text-sm" disabled={st.staffRole !== 'admin'}>Спри</button></> : <><input type="hidden" name="status" value="active" /><button className="btn !min-h-[40px] text-sm" disabled={st.staffRole !== 'admin'}>Активирай</button></>}</form>
          {u.is_provider && <form action={setVerificationAction}><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="status" value={u.verification_status === 'verified' ? 'none' : 'verified'} /><button className="btn !min-h-[40px] text-sm">{u.verification_status === 'verified' ? 'Свали проверката' : 'Маркирай като проверен'}</button></form>}</div>}
      </div>)}
    </div>
  );
}
