import { providerIdsFor } from '@/lib/company';
import Link from 'next/link';
import { q } from '@/lib/db';
import { requireVerified } from '@/lib/guard';
import { acceptRequestAction, declineRequestAction } from '../actions/services';
import { Flash } from '@/components/Flash';
import { dt, STATUS_BG } from '@/lib/format';
import { Pill } from '@/components/ui';

export const metadata = { title: 'Заявки' };
export default async function Requests({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const s = await requireVerified(); const { e, ok } = await searchParams;
  const ids = await providerIdsFor(s.id, 'requests');
  const rows = await q(`select r.*, l.title, cp.display_name client_name, pp.display_name provider_name from service_requests r join service_listings l on l.id=r.listing_id
     join profiles cp on cp.user_id=r.client_id join profiles pp on pp.user_id=r.provider_id where r.client_id=$1 or r.provider_id = any($2::uuid[]) order by r.created_at desc`, [s.id, ids]);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Директни заявки</h1>
      <Flash error={e} ok={ok ? 'Заявката е изпратена през Matchora.' : undefined} />
      {rows.length === 0 && <div className="card text-slate-600">Още няма заявки. Намерете услуга в <Link href="/services" className="text-teal underline">търсенето</Link>.</div>}
      {rows.map((r: any) => (
        <div key={r.id} className="card space-y-2">
          <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{r.title}</h2><Pill tone={r.status === 'accepted' ? 'good' : r.status === 'declined' ? 'bad' : 'spons'}>{STATUS_BG[r.status]}</Pill></div>
          <p className="text-sm text-slate-600">{ids.includes(r.provider_id) ? `От ${r.client_name}` : `До ${r.provider_name}`} · {dt(r.created_at)}</p>
          <p className="text-sm">{r.message}</p>
          <div className="flex flex-wrap gap-2"><Link href={`/requests/${r.id}`} className="btn !min-h-[40px] text-sm">Чат</Link>
            {ids.includes(r.provider_id) && r.status === 'pending' && <form className="flex gap-2"><input type="hidden" name="id" value={r.id} /><button formAction={acceptRequestAction} className="btn btn-primary !min-h-[40px] text-sm">Приеми</button><button formAction={declineRequestAction} className="btn !min-h-[40px] text-sm">Откажи</button></form>}</div>
        </div>))}
    </div>
  );
}
