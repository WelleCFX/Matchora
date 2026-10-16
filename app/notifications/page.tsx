import Link from 'next/link';
import { q } from '@/lib/db';
import { requireVerified } from '@/lib/guard';
import { dt } from '@/lib/format';
import { markNotificationsReadAction } from '../actions/jobs';

export const metadata = { title: 'Известия' };
export default async function Notifications() {
  const s = await requireVerified();
  const rows = await q('select * from notifications where user_id=$1 order by id desc limit 50', [s.id]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="font-display text-2xl">Известия</h1><form action={markNotificationsReadAction}><button className="btn !min-h-[40px] text-sm">Маркирай всички като прочетени</button></form></div>
      {rows.length === 0 && <div className="card text-slate-600">Още няма известия.</div>}
      {rows.map((n: any) => <Link key={n.id} href={n.link || '/dashboard'} className={`card block ${n.read_at ? '' : 'border-teal'}`}><p className={n.read_at ? '' : 'font-semibold'}>{n.title}</p><p className="text-xs text-slate-500">{dt(n.created_at)}</p></Link>)}
    </div>
  );
}
