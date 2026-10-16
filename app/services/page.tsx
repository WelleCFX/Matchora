import Link from 'next/link';
import { q } from '@/lib/db';
import { searchListings } from '@/lib/search';
import { getSponsored, recordAdEvent } from '@/lib/ads';
import { getSession, clientIp } from '@/lib/auth';
import { headers } from 'next/headers';
import { CITIES } from '@/lib/validation';
import { priceText, stars } from '@/lib/format';
import { Pill } from '@/components/ui';

export const metadata = { title: 'Търсене на услуги' };
export default async function Search({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const cats = await q('select slug, name from categories order by sort');
  const rows = await searchListings({ q: sp.q, category: sp.category, city: sp.city, remote: sp.remote === 'on', maxPrice: sp.max ? Number(sp.max) : undefined, verified: sp.verified === 'on', page: sp.page ? Number(sp.page) : 1 });
  const first = !sp.page || sp.page === '1';
  const spons = first ? await getSponsored({ placement: sp.category ? 'category' : 'search', categorySlug: sp.category, city: sp.city }) : [];
  if (spons.length) {   // показването се брои на сървъра, с дедупликация и без ботове
    const ua = (await headers()).get('user-agent') ?? '', ip = await clientIp(), u = await getSession();
    await Promise.all(spons.map((a) => recordAdEvent(a.campaign_id, 'impression', { ip, ua, userId: u?.id })));
  }
  const sponsoredIds = new Set(spons.map((a) => a.id));
  const organic = rows.filter((r: any) => !sponsoredIds.has(r.id));
  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl">Какво услуга търсите?</h1>
      <form className="space-y-3" action="/services">
        <input name="q" defaultValue={sp.q} className="input !min-h-[56px] text-lg" placeholder="Например: смяна на ел. табло, почистване" aria-label="Търсене" />
        <div className="grid grid-cols-2 gap-3">
          <select name="category" defaultValue={sp.category ?? ''} className="input" aria-label="Категория"><option value="">Всички категории</option>{cats.map((c: any) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
          <select name="city" defaultValue={sp.city ?? ''} className="input" aria-label="Град"><option value="">Всички градове</option>{CITIES.map((c) => <option key={c}>{c}</option>)}</select>
          <input name="max" type="number" min="0" defaultValue={sp.max} className="input" placeholder="Макс. цена, €" aria-label="Максимална цена" />
          <div className="flex flex-col justify-center gap-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="remote" defaultChecked={sp.remote === 'on'} /> Дистанционно</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="verified" defaultChecked={sp.verified === 'on'} /> Само проверени</label>
          </div>
        </div>
        <button className="btn btn-primary w-full">Търси</button>
      </form>
      {spons.length > 0 && (
        <section className="space-y-3" aria-label="Спонсорирани резултати">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">Спонсорирано</p>
          {spons.map((r) => (
            <a key={r.campaign_id} href={`/api/ad/${r.campaign_id}/click`} rel="sponsored" className="card block space-y-2 border-amber-300">
              <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{r.title}</h2><Pill tone="spons">Спонсорирано</Pill></div>
              <p className="text-sm text-slate-600">{r.business_name || r.display_name} · {r.city}{r.remote ? ' / дистанционно' : ''}</p>
              <div className="flex flex-wrap gap-2"><Pill>{stars(r.rating, r.reviews)}</Pill>{r.verification_status === 'verified' && <Pill tone="good">Проверен</Pill>}<Pill>{r.category}</Pill></div>
              <p className="font-display">{priceText(r.price_type, r.price_cents)}</p>
            </a>))}
        </section>)}
      <div className="space-y-3">
        {organic.length === 0 && <div className="card text-slate-600">Няма услуги по тези критерии. Пробвайте друга дума или махнете филтър.</div>}
        {organic.map((r: any) => (
          <Link key={r.id} href={`/services/${r.id}`} className="card block space-y-2">
            <h2 className="font-semibold">{r.title}</h2>
            <p className="text-sm text-slate-600">{r.business_name || r.display_name} · {r.city}{r.remote ? ' / дистанционно' : ''}</p>
            <div className="flex flex-wrap gap-2"><Pill>{stars(r.rating, r.reviews)}</Pill>{r.verification_status === 'verified' && <Pill tone="good">Проверен</Pill>}<Pill>{r.category}</Pill></div>
            <p className="font-display">{priceText(r.price_type, r.price_cents)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
