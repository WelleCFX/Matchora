'use server';
import { q, tx } from '@/lib/db';
import { guarded, requireProvider, requireStaff } from '@/lib/guard';
import { audit } from '@/lib/auth';
import { createCampaign, reviewCampaign, stopCampaign, togglePause } from '@/lib/ads';
import { BidError } from '@/lib/bids';

export async function createCampaignAction(f: FormData) {
  const s = await requireProvider();
  return guarded('/ads', async () => {
    await tx((c) => createCampaign(c, { providerId: s.id, listingId: String(f.get('listingId')), placement: String(f.get('placement')), startsOn: String(f.get('startsOn')), days: Math.floor(Number(f.get('days'))) }));
    return '/ads?ok=1';
  });
}
export async function pauseCampaignAction(f: FormData) { const s = await requireProvider(); return guarded('/ads', () => tx((c) => togglePause(c, String(f.get('id')), s.id))); }
export async function stopCampaignAction(f: FormData) { const s = await requireProvider(); return guarded('/ads', () => tx((c) => stopCampaign(c, String(f.get('id')), s.id, false))); }

async function review(f: FormData, approve: boolean) {
  const s = await requireStaff('moderator');
  return guarded('/admin/ads', async () => {
    await tx((c) => reviewCampaign(c, String(f.get('id')), s.id, approve, String(f.get('note') ?? '').slice(0, 300)));
    await audit(s.id, approve ? 'ad_approved' : 'ad_rejected', { campaignId: String(f.get('id')) });
  });
}
export async function approveAdAction(f: FormData) { return review(f, true); }
export async function rejectAdAction(f: FormData) { return review(f, false); }
export async function staffStopAdAction(f: FormData) {
  const s = await requireStaff('moderator');
  return guarded('/admin/ads', async () => { await tx((c) => stopCampaign(c, String(f.get('id')), s.id, true)); await audit(s.id, 'ad_stopped', { campaignId: String(f.get('id')) }); });
}
export async function updateAdSettingsAction(f: FormData) {
  const s = await requireStaff('admin');
  return guarded('/admin/settings', async () => {
    const v = { search_per_day: Number(f.get('search_per_day')), category_per_day: Number(f.get('category_per_day')), home_per_day: Number(f.get('home_per_day')), slots: Number(f.get('slots')), max_days: Number(f.get('max_days')) };
    if (!Object.values(v).every((n) => Number.isInteger(n) && n >= 1) || v.slots > 6 || v.max_days > 90) throw new BidError('Стойностите трябва да са цели числа (слотове до 6, срок до 90 дни)');
    await q("update app_settings set value=$1, updated_at=now() where key='ads'", [JSON.stringify(v)]);
    await audit(s.id, 'ad_settings_changed', v);
  });
}
