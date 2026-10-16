import Link from 'next/link';
import { getSession, clientIp } from '@/lib/auth';
import { getSponsored, recordAdEvent } from '@/lib/ads';
import { headers } from 'next/headers';
import { priceText } from '@/lib/format';
import { Pill } from '@/components/ui';

export default async function Home() {
  const s = await getSession();
  const promo = await getSponsored({ placement: 'home' });
  if (promo.length) { const ua = (await headers()).get('user-agent') ?? '', ip = await clientIp(); await Promise.all(promo.map((a) => recordAdEvent(a.campaign_id, 'impression', { ip, ua, userId: s?.id }))); }
  return (
    <div className="space-y-6">
      <section className="space-y-3 pt-4">
        <h1 className="font-display text-3xl leading-tight">Намерете изпълнител за всяка работа</h1>
        <p className="text-slate-600 dark:text-slate-300">Ремонти, ВиК, електроуслуги, почистване, уроци и още. Сравнете оферти и изберете сами.</p>
        {!s && <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/services" className="btn btn-primary">Намери услуга</Link>
          <Link href="/register" className="btn">Създай акаунт</Link>
          <Link href="/login" className="btn">Вход</Link>
        </div>}
        {s && <Link href="/dashboard" className="btn btn-primary">Към таблото</Link>}
      </section>
      {promo.length > 0 && <section className="space-y-3" aria-label="Спонсорирани услуги">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">Спонсорирано</p>
        {promo.map((r) => <a key={r.campaign_id} href={`/api/ad/${r.campaign_id}/click`} rel="sponsored" className="card block space-y-1 border-amber-300"><div className="flex justify-between gap-2"><h2 className="font-semibold">{r.title}</h2><Pill tone="spons">Спонсорирано</Pill></div><p className="text-sm text-slate-600">{r.business_name || r.display_name} · {r.city}</p><p className="font-display">{priceText(r.price_type, r.price_cents)}</p></a>)}
      </section>}
      <p className="text-sm text-slate-500">Етап 1 (P0): акаунти, услуги, търсене, абонаменти, задания, оферти, кредити и Matchora Bids са налични.</p>
    </div>
  );
}
