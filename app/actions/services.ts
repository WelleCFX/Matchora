'use server';
import { canActFor, providerIdsFor } from '@/lib/company';
import { z } from 'zod';
import { q, tx } from '@/lib/db';
import { activePlan } from '@/lib/billing';
import { guarded, requireProvider, requireVerified } from '@/lib/guard';
import { BidError } from '@/lib/bids';
import { notify } from '@/lib/notify';
import { emailUser } from '@/lib/notify';

const listingSchema = z.object({
  title: z.string().trim().min(6, 'Заглавието е твърде кратко').max(100),
  description: z.string().trim().min(10, 'Описанието е твърде кратко').max(2000),
  categoryId: z.coerce.number().int().positive(),
  city: z.string().trim().min(2, 'Изберете град').max(60),
  priceType: z.enum(['fixed', 'from', 'negotiable']),
  price: z.coerce.number().min(0).max(1_000_000).optional(),
  remote: z.string().optional().transform((v) => v === 'on'),
});

async function activeCount(providerId: string, exceptId?: string) {
  return (await q("select count(*)::int n from service_listings where provider_id=$1 and status='active' and ($2::uuid is null or id<>$2)", [providerId, exceptId ?? null]))[0].n as number;
}
async function assertCanActivate(providerId: string, exceptId?: string) {
  const plan = await activePlan(providerId);
  if (!plan) throw new BidError('Нужен е активен платен план, за да публикувате услуги');
  if ((await activeCount(providerId, exceptId)) >= plan.active_limit) throw new BidError(`Лимитът на плана ${plan.name} е ${plan.active_limit} активни услуги`);
}

async function actingProvider(userId: string, f: FormData, perm: 'services' | 'requests') {
  const pid = String(f.get('providerId') || userId);
  if (!(await canActFor(userId, pid, perm))) throw new BidError('Нямате право да действате от името на тази фирма');
  return pid;
}

export async function createListingAction(f: FormData) {
  const s = await requireVerified();
  return guarded('/my/services', async () => {
    const pid = await actingProvider(s.id, f, 'services');
    const p = listingSchema.safeParse(Object.fromEntries(f));
    if (!p.success) throw new BidError(p.error.issues[0].message);
    const d = p.data;
    if (d.priceType !== 'negotiable' && !(d.price && d.price > 0)) throw new BidError('Въведете цена');
    await assertCanActivate(pid);
    await q('insert into service_listings(provider_id,category_id,title,description,price_type,price_cents,city,remote) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [pid, d.categoryId, d.title, d.description, d.priceType, d.priceType === 'negotiable' ? null : Math.round((d.price ?? 0) * 100), d.city, d.remote]);
  });
}

export async function toggleListingAction(f: FormData) {
  const s = await requireVerified();
  const id = String(f.get('id'));
  return guarded('/my/services', async () => {
    const l = (await q('select status, provider_id from service_listings where id=$1', [id]))[0];
    if (!l || !(await canActFor(s.id, l.provider_id, 'services'))) throw new BidError('Услугата не е намерена');
    if (l.status === 'removed') throw new BidError('Услугата е премахната от модерация');
    if (l.status === 'active') await q("update service_listings set status='paused', updated_at=now() where id=$1", [id]);
    else { await assertCanActivate(l.provider_id, id); await q("update service_listings set status='active', updated_at=now() where id=$1", [id]); }
  });
}

export async function sendRequestAction(f: FormData) {
  const s = await requireVerified();
  const listingId = String(f.get('listingId'));
  return guarded(`/services/${listingId}`, async () => {
    const message = String(f.get('message') ?? '').trim();
    if (message.length < 10 || message.length > 1000) throw new BidError('Съобщението трябва да е между 10 и 1000 символа');
    const l = (await q(`select l.id, l.provider_id, l.title from service_listings l join subscriptions sb on sb.provider_id=l.provider_id and sb.status='active' and sb.period_end>now()
                         where l.id=$1 and l.status='active'`, [listingId]))[0];
    if (!l) throw new BidError('Услугата не е налична');
    if (l.provider_id === s.id) throw new BidError('Не можете да изпращате заявка към собствена услуга');
    const dup = await q("select 1 from service_requests where listing_id=$1 and client_id=$2 and status='pending'", [listingId, s.id]);
    if (dup.length) throw new BidError('Вече имате чакаща заявка към тази услуга');
    await tx(async (c) => {
      const r = (await c.query('insert into service_requests(listing_id,client_id,provider_id,message) values ($1,$2,$3,$4) returning id', [listingId, s.id, l.provider_id, message])).rows[0];
      await c.query('insert into messages(request_id,sender_id,body) values ($1,$2,$3)', [r.id, s.id, message]);
      await notify(c, l.provider_id, 'new_request', `Нова заявка за „${l.title}“`, `/requests/${r.id}`);
    });
    await emailUser(l.provider_id, 'Нова заявка в Matchora', '/requests');
    return '/requests?ok=1';
  });
}

async function answerRequest(f: FormData, accept: boolean) {
  const s = await requireVerified();
  const id = String(f.get('id'));
  return guarded('/requests', async () => {
    const allowed = await providerIdsFor(s.id, 'requests');
    await tx(async (c) => {
      const r = (await c.query("select * from service_requests where id=$1 and provider_id = any($2::uuid[]) for update", [id, allowed])).rows[0];
      if (!r || r.status !== 'pending') throw new BidError('Заявката не е налична');
      await c.query('update service_requests set status=$2 where id=$1', [id, accept ? 'accepted' : 'declined']);
      if (accept) {
        const o = (await c.query('insert into orders(request_id,client_id,provider_id) values ($1,$2,$3) returning id', [id, r.client_id, r.provider_id])).rows[0];
        await c.query("insert into order_events(order_id,actor_id,to_status) values ($1,$2,'accepted')", [o.id, s.id]);
        await c.query("insert into messages(order_id,sender_id,body,system) values ($1,$2,'Заявката е приета. Договорете детайлите тук.',true)", [o.id, s.id]);
        if (r.provider_id !== s.id) await notify(c, r.provider_id, 'request_accepted_by_member', 'Член на екипа прие заявка', `/orders/${o.id}`);
        await notify(c, r.client_id, 'request_accepted', 'Заявката ви е приета', `/orders/${o.id}`);
      } else await notify(c, r.client_id, 'request_declined', 'Заявката ви е отказана', '/orders');
    });
  });
}

export async function acceptRequestAction(f: FormData) { return answerRequest(f, true); }
export async function declineRequestAction(f: FormData) { return answerRequest(f, false); }
