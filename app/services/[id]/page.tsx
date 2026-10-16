import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { priceText, stars, dt } from '@/lib/format';
import { sendRequestAction } from '../../actions/services';
import { reportAction } from '../../actions/jobs';
import { Flash } from '@/components/Flash';
import { Pill } from '@/components/ui';
import Link from 'next/link';

export default async function ServicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }) {
  const { id } = await params; const { e } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const l = (await q(`select l.*, c.name category, pr.display_name, pr.city pcity, pr.bio, pr.phone, pr.phone_public, pp.business_name, pp.verification_status, pp.service_area, pp.work_hours,
      exists(select 1 from subscriptions s where s.provider_id=l.provider_id and s.status='active' and s.period_end>now()) visible
      from service_listings l join categories c on c.id=l.category_id join profiles pr on pr.user_id=l.provider_id left join provider_profiles pp on pp.user_id=l.provider_id where l.id=$1`, [id]))[0];
  const s = await getSession();
  // публично са видими само активни услуги с действащ план; собственикът винаги вижда своята
  if (!l || (!(l.status === 'active' && l.visible) && s?.id !== l.provider_id)) notFound();
  const reviews = await q('select r.rating, r.body, r.reply, r.created_at, p.display_name from reviews r join profiles p on p.user_id=r.reviewer_id where r.provider_id=$1 order by r.created_at desc limit 10', [l.provider_id]);
  const avg = reviews.length ? reviews.reduce((a: number, r: any) => a + r.rating, 0) / reviews.length : 0;
  return (
    <div className="space-y-4">
      <Flash error={e} />
      <div className="card space-y-2">
        <h1 className="font-display text-2xl">{l.title}</h1>
        <p className="text-slate-600">{l.business_name || l.display_name} · {l.city}{l.remote ? ' / дистанционно' : ''}</p>
        <div className="flex flex-wrap gap-2"><Pill>{stars(avg, reviews.length)}</Pill>{l.verification_status === 'verified' ? <Pill tone="good">Проверен</Pill> : <Pill>Непроверен</Pill>}<Pill>{l.category}</Pill></div>
        <p className="font-display text-xl">{priceText(l.price_type, l.price_cents)}</p>
        <p className="whitespace-pre-wrap">{l.description}</p>
        {l.service_area && <p className="text-sm text-slate-600">Район: {l.service_area}</p>}
        {l.work_hours && <p className="text-sm text-slate-600">Работно време: {l.work_hours}</p>}
        {l.phone_public && l.phone && <p className="text-sm">Телефон: {l.phone}</p>}
      </div>
      {s && s.id !== l.provider_id && <form action={sendRequestAction} className="card space-y-3">
        <input type="hidden" name="listingId" value={l.id} />
        <h2 className="font-display text-lg">Изпратете заявка</h2>
        <p className="text-sm text-slate-600">Контактите остават скрити, докато не се разберете в чата на Matchora.</p>
        <textarea name="message" required minLength={10} maxLength={1000} className="input min-h-[110px]" placeholder="Опишете какво ви трябва" aria-label="Съобщение" />
        <button className="btn btn-primary w-full">Изпрати през Matchora</button>
      </form>}
      {!s && <div className="card"><p>За да изпратите заявка, <Link href="/register" className="text-teal underline">създайте акаунт</Link> или <Link href="/login" className="text-teal underline">влезте</Link>.</p></div>}
      <section className="card space-y-3"><h2 className="font-display text-lg">Отзиви</h2>
        {reviews.length === 0 && <p className="text-slate-600">Още няма отзиви.</p>}
        {reviews.map((r: any, i: number) => <div key={i} className="space-y-1 border-t border-slate-100 pt-3 first:border-0 first:pt-0"><div className="flex gap-2 text-sm"><b>{'★'.repeat(r.rating)}</b><Pill tone="good">Потвърдена поръчка</Pill><span className="text-slate-500">{dt(r.created_at)}</span></div><p>{r.body}</p>{r.reply && <p className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800"><b>Отговор:</b> {r.reply}</p>}</div>)}
      </section>
      {s && <form action={reportAction} className="text-sm"><input type="hidden" name="type" value="listing" /><input type="hidden" name="targetId" value={l.id} /><input type="hidden" name="back" value={`/services/${l.id}`} />
        <details><summary className="cursor-pointer text-slate-500">Подай сигнал</summary><div className="mt-2 flex gap-2"><input name="reason" className="input" placeholder="Причина" minLength={5} required /><button className="btn">Изпрати</button></div></details></form>}
    </div>
  );
}
