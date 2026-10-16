import { q } from '@/lib/db';
import { requireVerified } from '@/lib/guard';
import { activePlan } from '@/lib/billing';
import { priceText } from '@/lib/format';
import { createListingAction, toggleListingAction } from '../../actions/services';
import { CITIES } from '@/lib/validation';
import { Flash } from '@/components/Flash';
import { Pill } from '@/components/ui';
import { redirect } from 'next/navigation';
import { providerIdsFor } from '@/lib/company';
import Link from 'next/link';

export const metadata = { title: 'Моите услуги' };
export default async function MyServices({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const s = await requireVerified(); const { e } = await searchParams;
  const ids = await providerIdsFor(s.id, 'services');
  if (!s.isProvider && ids.length === 1) redirect('/dashboard?e=' + encodeURIComponent('Нужен е профил на изпълнител.'));
  const owners = await q('select p.user_id, coalesce(co.legal_name, p.display_name) name from profiles p left join companies co on co.owner_id=p.user_id where p.user_id = any($1::uuid[])', [ids]);
  const plan = await activePlan(s.id);
  const rows = await q('select l.*, c.name category from service_listings l join categories c on c.id=l.category_id where provider_id = any($1::uuid[]) order by created_at desc', [ids]);
  const cats = await q('select id, name from categories order by sort');
  const active = rows.filter((r: any) => r.status === 'active').length;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Моите услуги</h1>
      <Flash error={e} />
      <div className={`card ${plan ? '' : 'border-amber-400'}`}>{plan ? <p>План <b>{plan.name}</b>: активни услуги {active} от {plan.active_limit}. Валиден до {new Date(plan.period_end).toLocaleDateString('bg-BG')}.</p>
        : <p>Нямате активен платен план. Услугите ви са скрити от търсенето и не приемат заявки. <Link href="/subscription" className="text-teal underline">Изберете план</Link>.</p>}</div>
      <form action={createListingAction} className="card space-y-3">
        <h2 className="font-display text-lg">Нова услуга</h2>
        {owners.length > 1 && <select name="providerId" className="input" aria-label="От името на" defaultValue={s.id}>{owners.map((o: any) => <option key={o.user_id} value={o.user_id}>{o.user_id === s.id ? 'От мое име' : o.name}</option>)}</select>}
        <input name="title" className="input" placeholder="Заглавие" required minLength={6} maxLength={100} aria-label="Заглавие" />
        <textarea name="description" className="input min-h-[100px]" placeholder="Описание" required minLength={10} maxLength={2000} aria-label="Описание" />
        <div className="grid grid-cols-2 gap-3">
          <select name="categoryId" className="input" aria-label="Категория">{cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select name="city" className="input" aria-label="Град">{CITIES.map((c) => <option key={c}>{c}</option>)}</select>
          <select name="priceType" className="input" aria-label="Тип цена"><option value="fixed">Фиксирана</option><option value="from">От</option><option value="negotiable">По договаряне</option></select>
          <input name="price" type="number" min="0" step="0.01" className="input" placeholder="Цена, €" aria-label="Цена" />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remote" /> Дистанционна услуга</label>
        <button className="btn btn-primary w-full">Публикувай</button>
      </form>
      {rows.map((r: any) => (
        <div key={r.id} className="card space-y-2">
          <div className="flex items-start justify-between gap-2"><Link href={`/services/${r.id}`} className="font-semibold">{r.title}</Link><Pill tone={r.status === 'active' && plan ? 'good' : r.status === 'removed' ? 'bad' : 'neutral'}>{r.status === 'active' ? (plan ? 'Активна' : 'Скрита') : r.status === 'paused' ? 'На пауза' : 'Премахната'}</Pill></div>
          <p className="text-sm text-slate-600">{r.category} · {r.city} · {priceText(r.price_type, r.price_cents)}</p>
          {r.status !== 'removed' && <form action={toggleListingAction}><input type="hidden" name="id" value={r.id} /><button className="btn !min-h-[40px] text-sm">{r.status === 'active' ? 'Постави на пауза' : 'Активирай'}</button></form>}
        </div>
      ))}
    </div>
  );
}
