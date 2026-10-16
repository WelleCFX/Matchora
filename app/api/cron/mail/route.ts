import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { flushOutbox } from '@/lib/mail';

export const dynamic = 'force-dynamic';
/** Вика се от планировчик (cron, Vercel Cron): Authorization: Bearer $CRON_SECRET */
export async function GET(req: Request) {
  const want = process.env.CRON_SECRET, got = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!want || want.length !== got.length || !timingSafeEqual(Buffer.from(want), Buffer.from(got))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json(await flushOutbox());
}
