import { q } from '@/lib/db';
import { requireProvider } from '@/lib/guard';
import { getAdSettings, PLACEMENT_BG } from '@/lib/ads';
import { getWallet } from '@/lib/credits';
import { createCampaignAction, pauseCampaignAction, stopCampaignAction } from '../actions/ads';
import { Flash } from '@/components/Flash';
import { Pill } from '@/components/ui';
import { d0 } from '@/lib/format';

export const metadata = { title: 'Реклами' };
const ST: Record<string, [string, 'good' | 'spons' | 'neutral' | 'bad']> = { pending_review: ['Чака одобрение', 'spons'], active: ['Активна', 'good'], paused: ['На пауза', 'neutral'], cancelled: ['Спряна', 'neutral'], rejected: ['Отхвърлена', 'bad'] };
export default async function Ads({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const s = await requireProvider(); const { e, ok } = await searchParams;
  const set = await getAdSettings(), w = await getWallet(s.id);
  const listings = await q("select id, title from service_listings where provider_id=$1 and status='active' order by created_at desc", [s.id]);
  const rows = await q('select c.*, l.title from ad_campaigns c join service_listings l on l.id=c.listing_id where c.provider_id=$1 order by c.created_at desc', [s.id]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Реклами</h1>
      <Flash error={e} ok={ok ? 'Рекламата е изпратена за одобрение. Кредитите са резервирани и се връщат при отказ.' : undefined} />
      <p className="rounded-xl bg-teal-soft p-3 text-sm text-slate-900">Платените позиции са обозначени „Спонсорирано“ и не променят рейтинга ви. Налични кредити: <b>{w.available}</b>.</p>
      <form action={createCampaignAction} className="card space-y-3">
        <h2 className="font-display text-lg">Нова реклама</h2>
        <select name="listingId" className="input" required aria-label="Услуга">{listings.length === 0 && <option value="">Нямате активни услуги</option>}{listings.map((l: any) => <option key={l.id} value={l.id}>{l.title}</option>)}</select>
        <select name="placement" className="input" aria-label="Място">{(['search', 'category', 'home'] as const).map((p) => <option key={p} value={p}>{PLACEMENT_BG[p]}: {set[`${p}_per_day` as const]} кр./ден</option>)}</select>
        <div className="grid grid-cols-2 gap-3"><input name="startsOn" type="date" min={today} defaultValue={today} className="input" required aria-label="Начало" /><input name="days" type="number" min="1" max={set.max_days} defaultValue={7} className="input" required aria-label="Дни" /></div>
        <p className="text-xs text-slate-500">Връщане на кредитите: при отказ от модератор или отмяна преди началото. След старта не се връщат.</p>
        <button className="btn btn-primary w-full" disabled={listings.length === 0}>Поръчай</button>
      </form>
      {rows.map((c: any) => (
        <div key={c.id} className="card space-y-2">
          <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{c.title}</h3><Pill tone={ST[c.status][1]}>{ST[c.status][0]}</Pill></div>
          <p className="text-sm text-slate-600">{PLACEMENT_BG[c.placement]} · {d0(c.starts_on)} – {d0(c.ends_on)} · {c.cost_credits} кр.</p>
          <p className="text-sm">Показвания: <b>{c.impressions}</b> · Кликове: <b>{c.clicks}</b> · CTR: <b>{c.impressions ? ((c.clicks / c.impressions) * 100).toFixed(1) : '0.0'}%</b></p>
          {c.review_note && <p className="text-sm text-slate-600">Бележка: {c.review_note}</p>}
          {['pending_review', 'active', 'paused'].includes(c.status) && <div className="flex gap-2">
            {c.status !== 'pending_review' && <form action={pauseCampaignAction}><input type="hidden" name="id" value={c.id} /><button className="btn !min-h-[40px] text-sm">{c.status === 'active' ? 'Пауза' : 'Поднови'}</button></form>}
            <form action={stopCampaignAction}><input type="hidden" name="id" value={c.id} /><button className="btn !min-h-[40px] border-red-400 text-sm text-red-700">Спри</button></form></div>}
        </div>))}
      <p className="text-xs text-slate-500">Показванията и кликовете се броят най-много веднъж на час от един посетител; ботове и вашите собствени прегледи не се броят.</p>
    </div>
  );
}
