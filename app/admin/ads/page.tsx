import { q } from '@/lib/db';
import { requireStaff } from '@/lib/guard';
import { approveAdAction, rejectAdAction, staffStopAdAction } from '../../actions/ads';
import { Flash } from '@/components/Flash';
import { PLACEMENT_BG } from '@/lib/ads';
import { d0 } from '@/lib/format';
import { Pill } from '@/components/ui';

export const metadata = { title: 'Реклами (админ)' };
export default async function AdminAds({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  await requireStaff('moderator'); const { e } = await searchParams;
  const rows = await q(`select c.*, l.title, p.display_name from ad_campaigns c join service_listings l on l.id=c.listing_id join profiles p on p.user_id=c.provider_id
     where c.status in ('pending_review','active','paused') order by (c.status='pending_review') desc, c.created_at desc limit 60`);
  return (
    <div className="space-y-3"><h1 className="font-display text-2xl">Реклами</h1><Flash error={e} />
      {rows.length === 0 && <div className="card text-slate-600">Няма кампании.</div>}
      {rows.map((c: any) => {
        const suspicious = c.impressions >= 50 && c.clicks / c.impressions > 0.5;
        return (<div key={c.id} className="card space-y-2">
          <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold">{c.title}</h3><p className="text-sm text-slate-600">{c.display_name} · {PLACEMENT_BG[c.placement]} · {d0(c.starts_on)}–{d0(c.ends_on)} · {c.cost_credits} кр.</p></div>
            <div className="flex flex-col items-end gap-1"><Pill tone={c.status === 'pending_review' ? 'spons' : 'good'}>{c.status === 'pending_review' ? 'За одобрение' : c.status === 'active' ? 'Активна' : 'Пауза'}</Pill>{suspicious && <Pill tone="bad">Подозрителен CTR</Pill>}</div></div>
          <p className="text-sm">Показвания {c.impressions} · клик {c.clicks}</p>
          {c.status === 'pending_review'
            ? <form className="flex flex-wrap gap-2"><input type="hidden" name="id" value={c.id} /><input name="note" className="input" placeholder="Бележка" aria-label="Бележка" /><button formAction={approveAdAction} className="btn btn-primary">Одобри</button><button formAction={rejectAdAction} className="btn">Откажи и върни кредитите</button></form>
            : <form action={staffStopAdAction}><input type="hidden" name="id" value={c.id} /><button className="btn !min-h-[40px] border-red-400 text-sm text-red-700">Спри кампанията</button></form>}
        </div>);
      })}
    </div>
  );
}
