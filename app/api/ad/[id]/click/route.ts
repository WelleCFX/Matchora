import { NextResponse } from 'next/server';
import { q } from '@/lib/db';
import { recordAdEvent } from '@/lib/ads';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
/** Брои клик (с дедупликация и филтър за ботове) и пренасочва към услугата. Адресът не идва от заявката: няма open redirect. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.redirect(new URL('/services', req.url));
  const row = (await q('select listing_id from ad_campaigns where id=$1', [id]))[0];
  if (!row) return NextResponse.redirect(new URL('/services', req.url));
  const s = await getSession();
  await recordAdEvent(id, 'click', { ip: (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || '0', ua: req.headers.get('user-agent') ?? '', userId: s?.id });
  return NextResponse.redirect(new URL(`/services/${row.listing_id}`, req.url));
}
