import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { rank, threshold, type Prop } from '@/lib/bids';
import { getBidSettings } from '@/lib/settings';
import { getWallet } from '@/lib/credits';
import { activePlan } from '@/lib/billing';
import { eur, d0, STATUS_BG } from '@/lib/format';
import { acceptProposalAction, cancelJobAction, raiseBoostAction, setAutoAction, stopBoostAction, submitProposalAction, withdrawAction, reportAction } from '../../actions/jobs';
import { Flash } from '@/components/Flash';
import { Pill } from '@/components/ui';
import Link from 'next/link';

type P = Prop & { display_name: string; business_name: string | null; verification_status: string | null; rating: number; reviews: number };
const OK: Record<string, string> = { '1': 'Заданието е публикувано.', review: 'Заданието чака модерация и ще бъде публикувано след преглед.', offer: 'Офертата е подадена.' };

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string; sort?: string }> }) {
  const { id } = await params; const { e, ok, sort = 'price' } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSession();
  const j = (await q('select j.*, c.name category, cp.display_name client_name from jobs j join categories c on c.id=j.category_id join profiles cp on cp.user_id=j.client_id where j.id=$1', [id]))[0];
  if (!j) notFound();
  const staff = !!s && ['moderator', 'admin'].includes(s.staffRole);
  const owner = !!s && s.id === j.client_id;
  if (j.status === 'pending_review' && !owner && !staff) notFound();
  const set = await getBidSettings();
  const props = (await q(`select p.*, pr.display_name, pp.business_name, pp.verification_status, coalesce(rv.avg,0)::float rating, coalesce(rv.n,0)::int reviews
      from proposals p join profiles pr on pr.user_id=p.provider_id left join provider_profiles pp on pp.user_id=p.provider_id
      left join lateral (select avg(rating) avg, count(*) n from reviews where provider_id=p.provider_id) rv on true
      where p.job_id=$1 and p.status='submitted'`, [id])) as P[];
  const R = rank(props, set);
  const mine = s ? props.find((p) => p.provider_id === s.id) : undefined;
  const open = j.status === 'open';
  const wallet = s?.isProvider ? await getWallet(s.id) : null;
  const plan = s?.isProvider ? await activePlan(s.id) : null;
  const name = (p: P) => p.business_name || p.display_name;
  const sorted = [...R.organic].sort((a, b) => sort === 'rating' ? b.rating - a.rating : sort === 'days' ? a.delivery_days - b.delivery_days : a.price_cents - b.price_cents);

  const OfferCard = ({ p, spons }: { p: P; spons: boolean }) => (
    <div className="card space-y-2">
      <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{name(p)}</h3>{spons && <Pill tone="spons">Спонсорирано</Pill>}</div>
      <div className="flex flex-wrap gap-2"><Pill>{p.reviews ? `★ ${p.rating.toFixed(1)} (${p.reviews})` : 'Без оценки'}</Pill>{p.verification_status === 'verified' && <Pill tone="good">Проверен</Pill>}</div>
      <p className="flex justify-between"><span className="font-display text-lg">{eur(p.price_cents)}</span><span className="text-sm text-slate-600">{p.delivery_days} дни</span></p>
      <p className="whitespace-pre-wrap text-sm">{p.message}</p>
      {owner && open && <form action={acceptProposalAction}><input type="hidden" name="jobId" value={id} /><input type="hidden" name="proposalId" value={p.id} /><button className="btn btn-primary w-full">Приеми офертата</button></form>}
    </div>
  );

  return (
    <div className="space-y-4">
      <Flash error={e} ok={ok ? OK[ok] : undefined} />
      <div className="card space-y-2">
        <div className="flex items-start justify-between gap-2"><h1 className="font-display text-2xl">{j.title}</h1><Pill tone={open ? 'good' : 'neutral'}>{STATUS_BG[j.status]}</Pill></div>
        <p className="text-sm text-slate-600">{j.category} · {j.city}{j.remote ? ' / дистанционно' : ''} · от {j.client_name} · срок {d0(j.deadline)}</p>
        <p className="font-display text-lg">{eur(j.budget_min_cents)} – {eur(j.budget_max_cents)}</p>
        <p className="whitespace-pre-wrap">{j.description}</p>
        {(owner || staff) && (open || j.status === 'pending_review') && <form action={cancelJobAction}><input type="hidden" name="jobId" value={id} /><button className="btn !min-h-[40px] border-red-400 text-sm text-red-700">Откажи заданието</button></form>}
        {j.accepted_proposal_id && (owner || mine) && <p className="text-sm"><Link href="/orders" className="text-teal underline">Към поръчките</Link></p>}
      </div>

      {open && s && (
        <section className="card space-y-3">
          <h2 className="font-display text-lg">Matchora Bids: открито наддаване</h2>
          <p className="text-sm text-slate-600">Показват се само позиции и кредитни прагове. Платеното класиране не означава автоматична победа и не променя рейтинга. Равен залог: печели по-рано потвърденият.</p>
          <div className="grid gap-2">{Array.from({ length: set.slots }, (_, i) => { const p = R.sponsored[i]; return (
            <div key={i} className={`flex justify-between rounded-xl border px-3 py-2 ${p ? 'border-transparent bg-amber-100 text-amber-950' : 'border-dashed border-slate-300'} ${p && s && p.provider_id === s.id ? 'outline outline-2 outline-teal' : ''}`}>
              <span>Позиция {i + 1}{p && p.provider_id === s.id ? ' · вие' : ''}</span><b>{p ? `${p.boost_credits} кредита` : 'свободна'}</b></div>); })}</div>
          <p className="text-sm">Праг за влизане в топ {set.slots}: <b>{threshold(props, set)} кредита</b></p>
        </section>)}

      {open && s?.isProvider && !owner && !mine && (
        <form action={submitProposalAction} className="card space-y-3">
          <input type="hidden" name="jobId" value={id} />
          <h2 className="font-display text-lg">Подайте оферта</h2>
          {!plan && <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-950">Нужен е активен платен план. <Link href="/subscription" className="underline">Изберете план</Link>.</p>}
          <p className="rounded-xl bg-teal-soft p-3 text-sm text-slate-900">Стандартна оферта: {set.app_cost} кредита. Налични: <b>{wallet?.available ?? 0}</b>. Boost е по желание и не ви задължава да намалявате цената.</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="price">Цена, €</label><input id="price" name="price" type="number" min="1" step="0.01" className="input" required /></div>
            <div><label className="label" htmlFor="days">Срок, дни</label><input id="days" name="days" type="number" min="1" className="input" required /></div>
            <div><label className="label" htmlFor="boost">Boost, кредити</label><input id="boost" name="boost" type="number" min="0" defaultValue={0} className="input" /></div>
            <div><label className="label" htmlFor="max">Auto Boost: максимум</label><input id="max" name="max" type="number" min="0" defaultValue={0} className="input" /></div>
          </div>
          <div><label className="label" htmlFor="target">Желана позиция при Auto Boost</label><select id="target" name="target" className="input">{Array.from({ length: set.slots }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></div>
          <div><label className="label" htmlFor="message">Описание, обхват, включено</label><textarea id="message" name="message" className="input min-h-[110px]" required minLength={10} maxLength={2000} /></div>
          <button className="btn btn-primary w-full">Подай оферта</button>
        </form>)}

      {open && mine && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-display text-lg">Вашата оферта</h2><Pill tone={R.sponsored.includes(mine) ? 'spons' : 'neutral'}>{R.sponsored.includes(mine) ? `Позиция ${R.sponsored.indexOf(mine) + 1}` : 'Органичен списък'}</Pill></div>
          <p><span className="font-display text-lg">{eur(mine.price_cents)}</span> · {mine.delivery_days} дни · boost <b>{mine.boost_credits}</b> · налични {wallet?.available ?? 0} · резервирани {wallet?.reserved ?? 0}</p>
          {mine.boost_max > 0 && <p className="rounded-xl bg-teal-soft p-3 text-sm text-slate-900">Auto Boost: до {mine.boost_max} кредита, цел позиция {mine.boost_target}, стъпка {set.step}. Спира сам, ако няма средства.</p>}
          <form action={raiseBoostAction} className="flex gap-2"><input type="hidden" name="jobId" value={id} /><input type="hidden" name="proposalId" value={mine.id} />
            <input name="amount" type="number" min={mine.boost_credits > 0 ? mine.boost_credits + set.step : set.min_boost} className="input" placeholder={`Boost до (мин. ${mine.boost_credits > 0 ? mine.boost_credits + set.step : set.min_boost})`} aria-label="Нов boost" required /><button className="btn btn-primary">Увеличи</button></form>
          <form action={setAutoAction} className="flex gap-2"><input type="hidden" name="jobId" value={id} /><input type="hidden" name="proposalId" value={mine.id} />
            <input name="max" type="number" min="0" defaultValue={mine.boost_max} className="input" aria-label="Auto Boost максимум" />
            <select name="target" defaultValue={mine.boost_target} className="input !w-24" aria-label="Позиция">{Array.from({ length: set.slots }, (_, i) => <option key={i}>{i + 1}</option>)}</select><button className="btn">Запази</button></form>
          <div className="flex flex-wrap gap-2">
            {mine.boost_credits > 0 && <form action={stopBoostAction}><input type="hidden" name="jobId" value={id} /><input type="hidden" name="proposalId" value={mine.id} /><button className="btn !min-h-[40px] text-sm">Спри boost</button></form>}
            <form action={withdrawAction}><input type="hidden" name="jobId" value={id} /><input type="hidden" name="proposalId" value={mine.id} /><button className="btn !min-h-[40px] border-red-400 text-sm text-red-700">Оттегли офертата</button></form>
          </div>
          <p className="text-xs text-slate-500">Кредитът за кандидатстване не се връща при оттегляне. Резервираният boost се освобождава.</p>
        </section>)}

      {owner && (<>
        <h2 className="font-display text-lg">Получени оферти ({props.length})</h2>
        {props.length === 0 && <div className="card text-slate-600">Още няма оферти. Подходящите изпълнители получават известие.</div>}
        {R.sponsored.length > 0 && <><p className="text-xs font-semibold uppercase tracking-wider text-amber-800">Спонсорирани оферти (топ {set.slots})</p>{R.sponsored.map((p) => <OfferCard key={p.id} p={p} spons />)}</>}
        {sorted.length > 0 && <><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Органичен списък</p>
          <form className="flex items-center gap-2 text-sm"><label htmlFor="sort">Сортиране</label><select id="sort" name="sort" defaultValue={sort} className="input !min-h-[40px] !w-auto"><option value="price">Цена</option><option value="rating">Рейтинг</option><option value="days">Срок</option></select><button className="btn !min-h-[40px]">Ок</button></form></div>
          {sorted.map((p) => <OfferCard key={p.id} p={p} spons={false} />)}</>}
      </>)}
      {!owner && !s?.isProvider && !s && <div className="card"><p><Link href="/register" className="text-teal underline">Регистрирайте се като изпълнител</Link>, за да подадете оферта.</p></div>}
      {s && !owner && <form action={reportAction}><input type="hidden" name="type" value="job" /><input type="hidden" name="targetId" value={id} /><input type="hidden" name="back" value={`/jobs/${id}`} />
        <details className="text-sm"><summary className="cursor-pointer text-slate-500">Подай сигнал</summary><div className="mt-2 flex gap-2"><input name="reason" className="input" required minLength={5} placeholder="Причина" /><button className="btn">Изпрати</button></div></details></form>}
    </div>
  );
}
