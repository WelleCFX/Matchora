'use server';
import { tx, q } from '@/lib/db';
import { audit } from '@/lib/auth';
import { guarded, requireStaff } from '@/lib/guard';
import { BidError } from '@/lib/bids';
import { creditOp } from '@/lib/credits';
import { cancelJob } from '@/lib/jobs';
import { notify } from '@/lib/notify';

async function moderateJob(f: FormData, ok: boolean) {
  const s = await requireStaff('moderator'); const id = String(f.get('jobId'));
  return guarded('/admin', async () => {
    await tx(async (c) => {
      const j = (await c.query("select * from jobs where id=$1 and status='pending_review' for update", [id])).rows[0];
      if (!j) throw new BidError('Заданието не чака модерация');
      if (ok) { await c.query("update jobs set status='open' where id=$1", [id]); await notify(c, j.client_id, 'job_approved', 'Заданието ви е публикувано', `/jobs/${id}`); }
      else { await c.query("update jobs set status='cancelled', moderation_note=$2, closed_at=now() where id=$1", [id, String(f.get('note') || 'Отказано от модератор')]); await notify(c, j.client_id, 'job_rejected', 'Заданието ви не е одобрено', `/jobs/${id}`); }
    });
    await audit(s.id, ok ? 'job_approved' : 'job_rejected', { jobId: id });
  });
}
export async function approveJobAction(f: FormData) { return moderateJob(f, true); }
export async function rejectJobAction(f: FormData) { return moderateJob(f, false); }
export async function adminCancelJobAction(f: FormData) {
  const s = await requireStaff('moderator'); const id = String(f.get('jobId'));
  return guarded('/admin', async () => { await tx((c) => cancelJob(c, s.id, id, true)); await audit(s.id, 'job_cancelled_by_staff', { jobId: id }); });
}
export async function removeListingAction(f: FormData) {
  const s = await requireStaff('moderator'); const id = String(f.get('listingId'));
  return guarded('/admin', async () => { await q("update service_listings set status='removed', updated_at=now() where id=$1", [id]); await audit(s.id, 'listing_removed', { listingId: id }); });
}
async function closeReport(f: FormData, status: 'resolved' | 'dismissed') {
  const s = await requireStaff('moderator'); const id = Number(f.get('reportId'));
  return guarded('/admin', async () => {
    await q('update reports set status=$2, resolution=$3 where id=$1', [id, status, String(f.get('resolution') || '')]);
    await audit(s.id, 'report_resolved', { reportId: id });
  });
}
export async function resolveReportAction(f: FormData) { return closeReport(f, 'resolved'); }
export async function dismissReportAction(f: FormData) { return closeReport(f, 'dismissed'); }
export async function adjustCreditsAction(f: FormData) {
  const s = await requireStaff('admin');
  return guarded('/admin/ledger', async () => {
    const userId = String(f.get('userId')), amount = Math.trunc(Number(f.get('amount'))), reason = String(f.get('reason') ?? '').trim();
    if (!amount) throw new BidError('Въведете ненулева сума');
    if (reason.length < 5) throw new BidError('Причината е задължителна');
    await tx(async (c) => {
      if (!(await c.query('select 1 from users where id=$1', [userId])).rowCount) throw new BidError('Потребителят не съществува');
      await creditOp(c, { userId, type: 'admin_adjustment', amount, key: `adj:${crypto.randomUUID()}`, actor: s.id, note: reason });
    });
    await audit(s.id, 'credit_adjustment', { userId, amount, reason });
  });
}
export async function updateBidSettingsAction(f: FormData) {
  const s = await requireStaff('admin');
  return guarded('/admin/settings', async () => {
    const v = { app_cost: Number(f.get('app_cost')), min_boost: Number(f.get('min_boost')), step: Number(f.get('step')), slots: Number(f.get('slots')) };
    if (!Object.values(v).every((n) => Number.isInteger(n) && n >= 1) || v.slots > 5) throw new BidError('Стойностите трябва да са цели числа, а слотовете до 5');
    await q("update app_settings set value=$1, updated_at=now() where key='bids'", [JSON.stringify(v)]);
    await audit(s.id, 'bid_settings_changed', v);
  });
}
export async function setUserStatusAction(f: FormData) {
  const s = await requireStaff('admin'); const id = String(f.get('userId')), status = f.get('status') === 'suspended' ? 'suspended' : 'active';
  return guarded('/admin/users', async () => {
    if (id === s.id) throw new BidError('Не можете да спрете собствения си акаунт');
    await q('update users set status=$2 where id=$1', [id, status]);
    if (status === 'suspended') await q('delete from sessions where user_id=$1', [id]);
    await audit(s.id, `user_${status}`, { userId: id });
  });
}
export async function setVerificationAction(f: FormData) {
  const s = await requireStaff('moderator'); const id = String(f.get('userId')), v = String(f.get('status'));
  return guarded('/admin/users', async () => {
    if (!['verified', 'rejected', 'none', 'pending'].includes(v)) throw new BidError('Невалиден статус');
    await q('update provider_profiles set verification_status=$2 where user_id=$1', [id, v]);
    await audit(s.id, 'verification_set', { userId: id, status: v });
  });
}

export async function clawbackCreditsAction(f: FormData) {
  const s = await requireStaff('admin'); const id = String(f.get('paymentId'));
  return guarded('/admin', async () => {
    await tx(async (c) => {
      const p = (await c.query("select p.*, cp.credits from payments p join credit_packages cp on cp.id=p.ref where p.id=$1 and p.kind='credits' and p.status in ('refunded','disputed') for update", [id])).rows[0];
      if (!p || p.review_note?.startsWith('Приспаднати') || p.review_note?.startsWith('Прегледано')) throw new BidError('Плащането не чака преглед');
      const w = (await c.query('select available from credit_wallets where user_id=$1 for update', [p.user_id])).rows[0];
      const take = Math.min(p.credits, w?.available ?? 0);          // не може да се отиде под нула; остатъкът е похарчен
      if (take > 0) await creditOp(c, { userId: p.user_id, type: 'refund', amount: take, key: `clawback:${id}`, related: id, actor: s.id, note: 'Възстановено плащане' });
      await c.query('update payments set review_note=$2 where id=$1', [id, `Приспаднати ${take} от ${p.credits} кр.`]);
    });
    await audit(s.id, 'payment_clawback', { paymentId: id });
  });
}
export async function dismissPaymentReviewAction(f: FormData) {
  const s = await requireStaff('admin'); const id = String(f.get('paymentId'));
  return guarded('/admin', async () => { await q("update payments set review_note='Прегледано без корекция' where id=$1 and status in ('refunded','disputed')", [id]); await audit(s.id, 'payment_review_dismissed', { paymentId: id }); });
}
