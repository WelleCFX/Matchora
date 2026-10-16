import { providerIdsFor } from '@/lib/company';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import { requireVerified } from '@/lib/guard';
import { Chat } from '@/components/Chat';
import { Flash } from '@/components/Flash';

export default async function RequestChat({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }) {
  const s = await requireVerified(); const { id } = await params; const { e } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = (await q('select r.*, l.title from service_requests r join service_listings l on l.id=r.listing_id where r.id=$1 and (r.client_id=$2 or r.provider_id = any($3::uuid[]))', [id, s.id, await providerIdsFor(s.id, 'requests')]))[0];
  if (!r) notFound();   // чужди заявки не се разкриват
  return (<div className="space-y-4"><h1 className="font-display text-2xl">{r.title}</h1><Flash error={e} /><Chat requestId={id} userId={s.id} /></div>);
}
