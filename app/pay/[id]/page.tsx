import { notFound, redirect } from 'next/navigation';
import { q } from '@/lib/db';
import { requireVerified } from '@/lib/guard';
import { eur } from '@/lib/format';
import { paymentProvider } from '@/lib/billing';
import { simulatePaymentAction } from '../../actions/billing';
import { Flash } from '@/components/Flash';
import Link from 'next/link';

export const metadata = { title: 'Плащане' };
const MSG: Record<string, string> = { processed: 'Плащането е потвърдено и начислено точно веднъж.', duplicate: 'Повторно събитие: игнорирано. Нищо не е начислено втори път.', unknown: 'Непознато плащане.' };
export default async function Pay({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ r?: string; ev?: string }> }) {
  const s = await requireVerified(); const { id } = await params; const { r, ev } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = (await q('select * from payments where id=$1 and user_id=$2', [id, s.id]))[0];
  if (!p) notFound();
  if (paymentProvider() !== 'mock') redirect(p.kind === 'credits' ? '/credits' : '/subscription'); // реален доставчик: тук води checkout страницата му
  return (
    <div className="card space-y-4">
      <h1 className="font-display text-2xl">Плащане (тестов доставчик)</h1>
      <p>{p.kind === 'credits' ? 'Пакет кредити' : 'Абонамент'} <b>{p.ref}</b> · {eur(p.amount_cents)} · статус: <b>{p.status === 'paid' ? 'платено' : p.status === 'pending' ? 'чака' : p.status}</b></p>
      {r && <Flash ok={MSG[r]} />}
      <p className="text-sm text-slate-600">Това е симулация. Реален доставчик (напр. Stripe) ще изпрати подписано събитие към /api/webhooks/payments. Тук същото събитие се изпраща от сървъра.</p>
      <form action={simulatePaymentAction} className="flex flex-wrap gap-3"><input type="hidden" name="paymentId" value={p.id} />
        {p.status === 'pending' && <button className="btn btn-primary">Симулирай успешно плащане</button>}
        {p.status === 'paid' && ev && <><input type="hidden" name="eventId" value={ev} /><button className="btn">Повтори същия webhook</button></>}
      </form>
      <Link href={p.kind === 'credits' ? '/credits' : '/subscription'} className="text-teal underline">Назад</Link>
    </div>
  );
}
