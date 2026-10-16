import { NextResponse } from 'next/server';
import { handleWebhook, verifySignature } from '@/lib/billing';

export const dynamic = 'force-dynamic';
/** Webhook на платежния доставчик. Подписът (HMAC-SHA256 на суровото тяло) е задължителен. */
export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySignature(body, req.headers.get('x-matchora-signature'))) return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  let ev: any;
  try { ev = JSON.parse(body); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (typeof ev.id !== 'string' || typeof ev.payment_id !== 'string' || !['payment.succeeded', 'payment.failed'].includes(ev.type)) return NextResponse.json({ error: 'bad event' }, { status: 400 });
  const r = await handleWebhook(ev);
  return NextResponse.json({ result: r }, { status: r === 'unknown' ? 404 : 200 });
}
