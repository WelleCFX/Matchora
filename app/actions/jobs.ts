'use server';
import { providerIdsFor } from '@/lib/company';
import { z } from 'zod';
import { tx, q } from '@/lib/db';
import { guarded, requireProvider, requireVerified, requireStaff } from '@/lib/guard';
import { BidError, raiseBoost, setAuto, stopBoost, submitProposal, withdrawProposal } from '@/lib/bids';
import { acceptProposal, advanceOrder, cancelJob, needsReview } from '@/lib/jobs';
import { emailUser, notify } from '@/lib/notify';

const jobSchema = z.object({
  title: z.string().trim().min(8, 'Заглавието е твърде кратко').max(120),
  description: z.string().trim().min(20, 'Опишете заданието с поне 20 символа').max(3000),
  categoryId: z.coerce.number().int().positive(),
  city: z.string().trim().min(2).max(60),
  remote: z.string().optional().transform((v) => v === 'on'),
  budgetMin: z.coerce.number().positive('Бюджетът трябва да е положителен').max(10_000_000),
  budgetMax: z.coerce.number().positive().max(10_000_000),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Изберете краен срок'),
}).refine((d) => d.budgetMax >= d.budgetMin, { message: 'Бюджетът „до“ трябва да е не по-малък от „от“', path: ['budgetMax'] })
  .refine((d) => new Date(d.deadline) >= new Date(new Date().toDateString()), { message: 'Крайният срок е в миналото', path: ['deadline'] });

export async function createJobAction(f: FormData) {
  const s = await requireVerified();
  return guarded('/jobs/new', async () => {
    const p = jobSchema.safeParse(Object.fromEntries(f));
    if (!p.success) throw new BidError(p.error.issues[0].message);
    const d = p.data, review = needsReview(`${d.title} ${d.description}`);
    const id = (await q(`insert into jobs(client_id,category_id,title,description,city,remote,budget_min_cents,budget_max_cents,deadline,status)
                         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [s.id, d.categoryId, d.title, d.description, d.city, d.remote, Math.round(d.budgetMin * 100), Math.round(d.budgetMax * 100), d.deadline, review ? 'pending_review' : 'open']))[0].id;
    return `/jobs/${id}${review ? '?ok=review' : '?ok=1'}`;
  });
}

export async function submitProposalAction(f: FormData) {
  const s = await requireProvider();
  const jobId = String(f.get('jobId'));
  return guarded(`/jobs/${jobId}`, async () => {
    const msg = String(f.get('message') ?? '').trim();
    if (msg.length < 10) throw new BidError('Опишете офертата с поне 10 символа');
    const id = await tx((c) => submitProposal(c, {
      jobId, providerId: s.id, price: Math.round(Number(f.get('price')) * 100), days: Math.floor(Number(f.get('days'))), message: msg,
      boost: Math.floor(Number(f.get('boost') || 0)), max: Math.floor(Number(f.get('max') || 0)), target: Math.min(5, Math.max(1, Math.floor(Number(f.get('target') || 1)))),
    }));
    const j = (await q('select client_id, title from jobs where id=$1', [jobId]))[0];
    await tx((c) => notify(c, j.client_id, 'new_proposal', `Нова оферта за „${j.title}“`, `/jobs/${jobId}`));
    await emailUser(j.client_id, 'Нова оферта по вашето задание', `/jobs/${jobId}`);
    return `/jobs/${jobId}?ok=offer`;
  });
}
export async function raiseBoostAction(f: FormData) {
  const s = await requireProvider(); const jobId = String(f.get('jobId'));
  return guarded(`/jobs/${jobId}`, () => tx((c) => raiseBoost(c, String(f.get('proposalId')), s.id, Math.floor(Number(f.get('amount'))))));
}
export async function setAutoAction(f: FormData) {
  const s = await requireProvider(); const jobId = String(f.get('jobId'));
  return guarded(`/jobs/${jobId}`, () => tx((c) => setAuto(c, String(f.get('proposalId')), s.id, Math.floor(Number(f.get('max') || 0)), Math.min(5, Math.max(1, Math.floor(Number(f.get('target') || 1)))))));
}
export async function stopBoostAction(f: FormData) {
  const s = await requireProvider(); const jobId = String(f.get('jobId'));
  return guarded(`/jobs/${jobId}`, () => tx((c) => stopBoost(c, String(f.get('proposalId')), s.id)));
}
export async function withdrawAction(f: FormData) {
  const s = await requireProvider(); const jobId = String(f.get('jobId'));
  return guarded(`/jobs/${jobId}`, () => tx((c) => withdrawProposal(c, String(f.get('proposalId')), s.id)));
}
export async function acceptProposalAction(f: FormData) {
  const s = await requireVerified(); const jobId = String(f.get('jobId'));
  return guarded(`/jobs/${jobId}`, async () => `/orders/${await tx((c) => acceptProposal(c, s.id, String(f.get('proposalId'))))}`);
}
export async function cancelJobAction(f: FormData) {
  const s = await requireVerified(); const jobId = String(f.get('jobId'));
  return guarded(`/jobs/${jobId}`, async () => { await tx((c) => cancelJob(c, s.id, jobId, ['moderator', 'admin'].includes(s.staffRole))); });
}

export async function advanceOrderAction(f: FormData) {
  const s = await requireVerified(); const id = String(f.get('orderId'));
  return guarded(`/orders/${id}`, () => tx((c) => advanceOrder(c, s.id, id, String(f.get('to')))));
}

async function orderAccess(orderId: string, userId: string) {
  return (await q('select * from orders where id=$1 and (client_id=$2 or provider_id=$2)', [orderId, userId]))[0];
}
export async function sendMessageAction(f: FormData) {
  const s = await requireVerified(); const orderId = f.get('orderId') ? String(f.get('orderId')) : null; const requestId = f.get('requestId') ? String(f.get('requestId')) : null;
  const back = orderId ? `/orders/${orderId}` : `/requests/${requestId}`;
  return guarded(back, async () => {
    const body = String(f.get('body') ?? '').trim();
    if (!body || body.length > 2000) throw new BidError('Съобщението е празно или твърде дълго');
    if (await (async () => { const r = await q("select count(*)::int n from messages where sender_id=$1 and created_at > now() - interval '1 minute'", [s.id]); return r[0].n >= 20; })()) throw new BidError('Твърде много съобщения. Опитайте след малко.');
    let other: string;
    if (orderId) { const o = await orderAccess(orderId, s.id); if (!o) throw new BidError('Нямате достъп до тази поръчка'); other = o.client_id === s.id ? o.provider_id : o.client_id; }
    else { const r = (await q('select * from service_requests where id=$1 and (client_id=$2 or provider_id = any($3::uuid[]))', [requestId, s.id, await providerIdsFor(s.id, 'requests')]))[0]; if (!r) throw new BidError('Нямате достъп до тази заявка'); other = r.client_id === s.id ? r.provider_id : r.client_id; }
    await tx(async (c) => {
      await c.query('insert into messages(order_id,request_id,sender_id,body) values ($1,$2,$3,$4)', [orderId, requestId, s.id, body]);
      await notify(c, other, 'message', 'Ново съобщение', back);
    });
  });
}

export async function reviewAction(f: FormData) {
  const s = await requireVerified(); const orderId = String(f.get('orderId'));
  return guarded(`/orders/${orderId}`, async () => {
    const rating = Math.floor(Number(f.get('rating'))), body = String(f.get('body') ?? '').trim();
    if (rating < 1 || rating > 5) throw new BidError('Оценката е от 1 до 5');
    if (body.length < 5) throw new BidError('Напишете кратък отзив');
    const o = (await q("select * from orders where id=$1 and client_id=$2 and status='completed'", [orderId, s.id]))[0];
    if (!o) throw new BidError('Ревю може да остави само клиентът по завършена поръчка');
    const r = await q('insert into reviews(order_id,reviewer_id,provider_id,rating,body) values ($1,$2,$3,$4,$5) on conflict (order_id) do nothing returning id', [orderId, s.id, o.provider_id, rating, body]);
    if (!r.length) throw new BidError('Вече сте оставили ревю за тази поръчка');
  });
}
export async function replyReviewAction(f: FormData) {
  const s = await requireProvider(); const orderId = String(f.get('orderId'));
  return guarded(`/orders/${orderId}`, async () => {
    const body = String(f.get('reply') ?? '').trim();
    if (body.length < 2 || body.length > 1000) throw new BidError('Отговорът е твърде кратък или дълъг');
    await q('update reviews set reply=$2 where order_id=$1 and provider_id=$3', [orderId, body, s.id]);
  });
}
export async function reportAction(f: FormData) {
  const s = await requireVerified(); const back = String(f.get('back') || '/');
  return guarded(back.startsWith('/') ? back : '/', async () => {
    const type = String(f.get('type')), reason = String(f.get('reason') ?? '').trim();
    if (!['listing', 'job', 'user', 'review', 'message'].includes(type)) throw new BidError('Невалиден сигнал');
    if (reason.length < 5) throw new BidError('Опишете причината');
    await q('insert into reports(reporter_id,target_type,target_id,reason) values ($1,$2,$3,$4)', [s.id, type, String(f.get('targetId')), reason]);
  });
}
export async function markNotificationsReadAction() {
  const s = await requireVerified();
  await q('update notifications set read_at=now() where user_id=$1 and read_at is null', [s.id]);
  const { redirect } = await import('next/navigation'); redirect('/notifications');
}
void requireStaff;
