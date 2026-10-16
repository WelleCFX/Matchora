import { NextResponse } from 'next/server';
import { handleStripeEvent, verifyStripeSignature } from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const body = await req.text();
  if (!verifyStripeSignature(body, req.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET ?? '')) return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  let ev: any; try { ev = JSON.parse(body); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  try { return NextResponse.json({ result: await handleStripeEvent(ev) }); }
  catch (e) { console.error('stripe webhook', e); return NextResponse.json({ error: 'server' }, { status: 500 }); }   // 500 => Stripe повтаря
}
