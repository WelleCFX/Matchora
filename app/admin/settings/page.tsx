import { requireStaff } from '@/lib/guard';
import { getBidSettings } from '@/lib/settings';
import { updateBidSettingsAction } from '../../actions/admin';
import { updateAdSettingsAction } from '../../actions/ads';
import { getAdSettings } from '@/lib/ads';
import { Flash } from '@/components/Flash';

export const metadata = { title: 'Настройки' };
export default async function Settings({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const s = await requireStaff('admin'); const { e } = await searchParams; const v = await getBidSettings(); const ad = await getAdSettings();
  const F = ({ k, l }: { k: keyof typeof v; l: string }) => <div><label className="label" htmlFor={k}>{l}</label><input id={k} name={k} type="number" min="1" max={k === 'slots' ? 5 : undefined} defaultValue={v[k]} className="input" required /></div>;
  return (<div className="space-y-4"><form action={updateBidSettingsAction} className="card space-y-3"><h1 className="font-display text-2xl">Настройки на Matchora Bids</h1><Flash error={e} />
    <F k="app_cost" l="Цена на стандартно кандидатстване, кредити" /><F k="min_boost" l="Минимален залог" /><F k="step" l="Минимална стъпка" /><F k="slots" l="Спонсорирани позиции (1–5)" /><button className="btn btn-primary w-full">Запази</button><span className="hidden">{s.id}</span></form>
    <form action={updateAdSettingsAction} className="card space-y-3"><h2 className="font-display text-lg">Цени на рекламите (кредити на ден)</h2>{(['search_per_day', 'category_per_day', 'home_per_day', 'slots', 'max_days'] as const).map((k) => <div key={k}><label className="label" htmlFor={`ad-${k}`}>{({ search_per_day: 'Търсене', category_per_day: 'Топ в категория', home_per_day: 'Начална страница', slots: 'Рекламни позиции', max_days: 'Максимален срок, дни' })[k]}</label><input id={`ad-${k}`} name={k} type="number" min="1" defaultValue={ad[k]} className="input" required /></div>)}<button className="btn btn-primary w-full">Запази</button></form></div>);
}
