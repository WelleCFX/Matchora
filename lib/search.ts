import { q } from './db';

const SYN: Record<string, string> = { ток: 'електро', контакт: 'електро', лампа: 'електро', кран: 'вик', тръба: 'вик', чистене: 'почистване', сайт: 'дигитални', магазин: 'дигитални', тапет: 'ремонти', боя: 'ремонти', нокти: 'красота', преместване: 'транспорт' };
export type SearchParams = { q?: string; category?: string; city?: string; remote?: boolean; maxPrice?: number; verified?: boolean; page?: number };

/** Видими са само активни услуги на изпълнители с действащ платен план. Релевантност, после рейтинг. */
export async function searchListings(p: SearchParams) {
  const terms = (p.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const k of Object.keys(SYN)) if ((p.q ?? '').toLowerCase().includes(k)) terms.push(SYN[k]);
  const clean = terms.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const tsq = clean.join(' | ');            // безопасен tsquery: само букви и цифри
  const text = clean.join(' ');
  const params: unknown[] = [tsq, text];
  const where: string[] = [`l.status='active'`];
  if (p.category) { params.push(p.category); where.push(`c.slug=$${params.length}`); }
  if (p.city) { params.push(p.city); where.push(`(l.city=$${params.length} or l.remote)`); }
  if (p.remote) where.push('l.remote');
  if (p.maxPrice) { params.push(Math.round(p.maxPrice * 100)); where.push(`(l.price_type='negotiable' or l.price_cents<=$${params.length})`); }
  if (p.verified) where.push(`pp.verification_status='verified'`);
  if (tsq) where.push(`(l.search @@ to_tsquery('simple', $1) or similarity(l.title,$2) > 0.15 or c.name ilike any (select '%'||t||'%' from unnest(string_to_array($2,' ')) t))`);
  params.push(30, ((p.page ?? 1) - 1) * 30);
  return q(`
    select l.id, l.title, l.description, l.price_type, l.price_cents, l.city, l.remote, c.name category, pr.display_name, pp.business_name, pp.verification_status,
           coalesce(rv.avg,0)::float rating, coalesce(rv.n,0)::int reviews
      from service_listings l
      join categories c on c.id=l.category_id
      join profiles pr on pr.user_id=l.provider_id
      left join provider_profiles pp on pp.user_id=l.provider_id
      join subscriptions s on s.provider_id=l.provider_id and s.status='active' and s.period_end>now()
      left join lateral (select avg(rating) avg, count(*) n from reviews where provider_id=l.provider_id) rv on true
     where ${where.join(' and ')}
     order by (case when $1::text='' then 0 else ts_rank(l.search, to_tsquery('simple', $1::text)) + similarity(l.title,$2::text) end) desc, rating desc, l.created_at desc
     limit $${params.length - 1} offset $${params.length}`, params);
}
