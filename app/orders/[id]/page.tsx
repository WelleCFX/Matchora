import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { requireVerified } from '@/lib/guard';
import { nextStep } from '@/lib/jobs';
import { eur, dt, STATUS_BG } from '@/lib/format';
import { advanceOrderAction, replyReviewAction, reviewAction } from '../../actions/jobs';
import { Chat } from '@/components/Chat';
import { Flash } from '@/components/Flash';
import { Pill } from '@/components/ui';

const LABEL: Record<string, string> = { scheduled: 'Планирай', in_progress: 'Започни работа', delivered: 'Отбележи като доставена', completed: 'Потвърди завършване' };
export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }) {
  const s = await requireVerified(); const { id } = await params; const { e } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const o = (await q(`select o.*, coalesce(j.title, l.title) title, cp.display_name client_name, pp.display_name provider_name
      from orders o left join jobs j on j.id=o.job_id left join service_requests r on r.id=o.request_id left join service_listings l on l.id=r.listing_id
      join profiles cp on cp.user_id=o.client_id join profiles pp on pp.user_id=o.provider_id where o.id=$1 and (o.client_id=$2 or o.provider_id=$2)`, [id, s.id]))[0];
  if (!o) notFound();   // чужди поръчки не се разкриват
  const ev = await q('select * from order_events where order_id=$1 order by id', [id]);
  const rv = (await q('select * from reviews where order_id=$1', [id]))[0];
  const step = nextStep(o.status);
  const can = step && (step.by === 'provider' ? o.provider_id === s.id : o.client_id === s.id);
  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <div className="flex items-start justify-between gap-2"><h1 className="font-display text-2xl">{o.title}</h1><Pill tone={o.status === 'completed' ? 'good' : 'neutral'}>{STATUS_BG[o.status]}</Pill></div>
        <p className="text-sm text-slate-600">Клиент: {o.client_name} · Изпълнител: {o.provider_name}</p>
        {o.price_cents && <p className="font-display text-lg">{eur(o.price_cents)}</p>}
        <p className="text-sm text-slate-600">Плащането между клиент и изпълнител е извън платформата в MVP.</p>
        <Flash error={e} />
        {can && <form action={advanceOrderAction}><input type="hidden" name="orderId" value={id} /><input type="hidden" name="to" value={step!.to} /><button className="btn btn-primary w-full">{LABEL[step!.to]}</button></form>}
        <ol className="space-y-1 text-xs text-slate-500">{ev.map((x: any) => <li key={x.id}>{dt(x.created_at)} · {STATUS_BG[x.to_status]}</li>)}</ol>
      </div>
      <Chat orderId={id} userId={s.id} />
      {o.status === 'completed' && (rv
        ? <div className="card space-y-2"><div className="flex gap-2"><b>{'★'.repeat(rv.rating)}</b><Pill tone="good">Потвърдена поръчка</Pill></div><p>{rv.body}</p>
            {rv.reply ? <p className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800"><b>Отговор:</b> {rv.reply}</p> : o.provider_id === s.id && <form action={replyReviewAction} className="flex gap-2"><input type="hidden" name="orderId" value={id} /><input name="reply" className="input" required minLength={2} placeholder="Публичен отговор" /><button className="btn">Отговори</button></form>}</div>
        : o.client_id === s.id && <form action={reviewAction} className="card space-y-3"><input type="hidden" name="orderId" value={id} /><h2 className="font-display text-lg">Оставете ревю</h2>
            <select name="rating" className="input" aria-label="Оценка" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}</select>
            <textarea name="body" className="input min-h-[90px]" required minLength={5} maxLength={1000} aria-label="Отзив" placeholder="Как мина работата?" />
            <button className="btn btn-primary w-full">Публикувай ревю</button></form>)}
    </div>
  );
}
