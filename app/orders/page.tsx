import Link from 'next/link';
import { q } from '@/lib/db';
import { requireVerified } from '@/lib/guard';
import { eur, dt, STATUS_BG } from '@/lib/format';
import { Pill } from '@/components/ui';

export const metadata = { title: 'Поръчки' };
export default async function Orders() {
  const s = await requireVerified();
  const rows = await q(`select o.*, coalesce(j.title, l.title) title, cp.display_name client_name, pp.display_name provider_name
      from orders o left join jobs j on j.id=o.job_id left join service_requests r on r.id=o.request_id left join service_listings l on l.id=r.listing_id
      join profiles cp on cp.user_id=o.client_id join profiles pp on pp.user_id=o.provider_id where o.client_id=$1 or o.provider_id=$1 order by o.created_at desc`, [s.id]);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Поръчки</h1>
      {rows.length === 0 && <div className="card text-slate-600">Поръчка се създава, когато клиент приеме оферта или изпълнител приеме заявка.</div>}
      {rows.map((o: any) => (
        <Link key={o.id} href={`/orders/${o.id}`} className="card block space-y-1">
          <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{o.title}</h2><Pill tone={o.status === 'completed' ? 'good' : 'neutral'}>{STATUS_BG[o.status]}</Pill></div>
          <p className="text-sm text-slate-600">{o.client_id === s.id ? `Изпълнител: ${o.provider_name}` : `Клиент: ${o.client_name}`} · {dt(o.created_at)}</p>
          {o.price_cents && <p className="font-display">{eur(o.price_cents)}</p>}
        </Link>))}
    </div>
  );
}
