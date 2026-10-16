import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { q } from './db';
import { BidError } from './bids';
import { creditOp } from './credits';
import { notify } from './notify';

export type AdSettings = { search_per_day: number; category_per_day: number; home_per_day: number; slots: number; max_days: number };
export const getAdSettings = async (c?: PoolClient): Promise<AdSettings> =>
  ((c ? (await c.query("select value from app_settings where key='ads'")).rows : await q("select value from app_settings where key='ads'"))[0].value);
export const PLACEMENT_BG: Record<string, string> = { search: 'Търсене (всички резултати)', category: 'Топ в категория', home: 'Начална страница' };
const priceOf = (s: AdSettings, p: string) => ({ search: s.search_per_day, category: s.category_per_day, home: s.home_per_day } as Record<string, number>)[p];

export async function createCampaign(c: PoolClient, i: { providerId: string; listingId: string; placement: string; startsOn: string; days: number }) {
  const s = await getAdSettings(c);
  if (!['search', 'category', 'home'].includes(i.placement)) throw new BidError('Невалидно място за реклама');
  if (!Number.isInteger(i.days) || i.days < 1 || i.days > s.max_days) throw new BidError(`Срокът е от 1 до ${s.max_days} дни`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.startsOn)) throw new BidError('Изберете начална дата');
  const today = new Date(new Date().toDateString()), start = new Date(i.startsOn);
  if (start < today || +start - +today > 60 * 864e5) throw new BidError('Началната дата е в миналото или твърде далеч напред');
  const l = (await c.query("select id, status from service_listings where id=$1 and provider_id=$2", [i.listingId, i.providerId])).rows[0];
  if (!l || l.status !== 'active') throw new BidError('Рекламира се само ваша активна услуга');
  const sub = await c.query("select 1 from subscriptions where provider_id=$1 and status='active' and period_end>now()", [i.providerId]);
  if (!sub.rowCount) throw new BidError('Нужен е активен платен план');
  const end = new Date(+start + (i.days - 1) * 864e5), cost = priceOf(s, i.placement) * i.days;
  const id = (await c.query('insert into ad_campaigns(provider_id,listing_id,placement,starts_on,ends_on,cost_credits) values ($1,$2,$3,$4,$5,$6) returning id',
    [i.providerId, i.listingId, i.placement, i.startsOn, end.toISOString().slice(0, 10), cost])).rows[0].id as string;
  try { await creditOp(c, { userId: i.providerId, type: 'debit_promotion', amount: cost, key: `promo:${id}`, related: id, actor: i.providerId }); }
  catch { throw new BidError(`Недостатъчно кредити (нужни: ${cost})`); }
  return id;
}
async function refund(c: PoolClient, camp: any, why: string) {
  await creditOp(c, { userId: camp.provider_id, type: 'promo_refund', amount: camp.cost_credits, key: `promo-refund:${camp.id}`, related: camp.id, actor: null, note: why });
}
export async function reviewCampaign(c: PoolClient, campaignId: string, staffId: string, approve: boolean, note: string) {
  const camp = (await c.query("select * from ad_campaigns where id=$1 and status='pending_review' for update", [campaignId])).rows[0];
  if (!camp) throw new BidError('Кампанията не чака преглед');
  await c.query('update ad_campaigns set status=$2, review_note=$3, reviewed_by=$4 where id=$1', [campaignId, approve ? 'active' : 'rejected', note || null, staffId]);
  if (!approve) await refund(c, camp, 'Отхвърлена реклама');
  await notify(c, camp.provider_id, 'ad_review', approve ? 'Рекламата ви е одобрена' : 'Рекламата ви е отхвърлена, кредитите са върнати', '/ads');
}
export async function stopCampaign(c: PoolClient, campaignId: string, actorId: string, staff: boolean) {
  const camp = (await c.query('select * from ad_campaigns where id=$1 for update', [campaignId])).rows[0];
  if (!camp || (camp.provider_id !== actorId && !staff)) throw new BidError('Кампанията не е намерена');
  if (!['pending_review', 'active', 'paused'].includes(camp.status)) throw new BidError('Кампанията вече е приключила');
  const notStarted = new Date(camp.starts_on) > new Date(new Date().toDateString());
  await c.query("update ad_campaigns set status='cancelled' where id=$1", [campaignId]);
  if (notStarted || camp.status === 'pending_review') await refund(c, camp, 'Отказана преди старт');      // след старт няма връщане
}
export async function togglePause(c: PoolClient, campaignId: string, providerId: string) {
  const camp = (await c.query('select * from ad_campaigns where id=$1 and provider_id=$2 for update', [campaignId, providerId])).rows[0];
  if (!camp || !['active', 'paused'].includes(camp.status)) throw new BidError('Кампанията не може да се паузира');
  await c.query('update ad_campaigns set status=$2 where id=$1', [campaignId, camp.status === 'active' ? 'paused' : 'active']);
}

/* ---------- показване ---------- */
const LIVE = `c.status='active' and current_date between c.starts_on and c.ends_on and l.status='active'
   and exists (select 1 from subscriptions s where s.provider_id=c.provider_id and s.status='active' and s.period_end>now())`;
export type AdRow = { campaign_id: string; id: string; title: string; description: string; price_type: string; price_cents: number | null; city: string; remote: boolean; category: string; display_name: string; business_name: string | null; verification_status: string | null; rating: number; reviews: number };

/** Справедлива ротация: първо кампаниите с най-малко показвания днес. Не зависи от рейтинга и не го променя. */
export async function getSponsored(o: { placement: 'search' | 'category' | 'home'; categorySlug?: string; city?: string; exclude?: string[] }): Promise<AdRow[]> {
  const s = await getAdSettings();
  const params: unknown[] = [o.placement === 'category' ? ['category', 'search'] : o.placement === 'search' ? ['search'] : ['home']];
  let extra = '';
  if (o.categorySlug) { params.push(o.categorySlug); extra += ` and cat.slug=$${params.length}`; }
  if (o.placement === 'category' && !o.categorySlug) extra += ' and false';       // „Топ в категория“ се показва само при избрана категория
  if (o.city) { params.push(o.city); extra += ` and (l.city=$${params.length} or l.remote)`; }
  params.push(s.slots);
  return q(`select c.id campaign_id, l.id, l.title, l.description, l.price_type, l.price_cents, l.city, l.remote, cat.name category, pr.display_name, pp.business_name, pp.verification_status,
              coalesce(rv.avg,0)::float rating, coalesce(rv.n,0)::int reviews
       from ad_campaigns c join service_listings l on l.id=c.listing_id join categories cat on cat.id=l.category_id
       join profiles pr on pr.user_id=l.provider_id left join provider_profiles pp on pp.user_id=l.provider_id
       left join lateral (select avg(rating) avg, count(*) n from reviews where provider_id=l.provider_id) rv on true
       where c.placement = any($1::text[]) and ${LIVE} ${extra}
       order by (select count(*) from ad_events e where e.campaign_id=c.id and e.kind='impression' and e.created_at::date=current_date), random()
       limit $${params.length}`, params);
}

const BOT = /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|curl|wget/i;
export const viewerHash = (ip: string, ua: string) => createHash('sha256').update(`${ip}|${ua}|${process.env.APP_SECRET ?? 'dev'}`).digest();
/** Брои събитие най-много веднъж на час от един зрител; ботове и собственикът на рекламата не се броят. */
export async function recordAdEvent(campaignId: string, kind: 'impression' | 'click', v: { ip: string; ua: string; userId?: string | null }): Promise<boolean> {
  if (BOT.test(v.ua) || !v.ua) return false;
  const camp = (await q(`select c.provider_id from ad_campaigns c join service_listings l on l.id=c.listing_id where c.id=$1 and ${LIVE}`, [campaignId]))[0];
  if (!camp || camp.provider_id === v.userId) return false;
  const ins = await q(`insert into ad_events(campaign_id, kind, viewer_hash, bucket) values ($1,$2,$3,date_trunc('hour', now())) on conflict do nothing returning id`, [campaignId, kind, viewerHash(v.ip, v.ua)]);
  if (!ins.length) return false;
  await q(`update ad_campaigns set ${kind === 'click' ? 'clicks=clicks+1' : 'impressions=impressions+1'} where id=$1`, [campaignId]);
  return true;
}
