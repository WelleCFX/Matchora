import { q } from '@/lib/db';
import { requireProvider } from '@/lib/guard';
import { activePlan } from '@/lib/billing';
import { eur, dt } from '@/lib/format';
import { cancelRenewalAction, checkoutAction } from '../actions/billing';
import { Flash } from '@/components/Flash';
import { Pill } from '@/components/ui';

export const metadata = { title: 'Абонамент' };
export default async function Subscription({ searchParams }: { searchParams: Promise<{ e?: string; paid?: string }> }) {
  const s = await requireProvider(); const { e, paid } = await searchParams;
  const cur = await activePlan(s.id);
  const plans = await q('select * from plans where is_active order by price_cents');
  const pays = await q("select p.*, i.number from payments p left join invoices i on i.payment_id=p.id where p.user_id=$1 and p.kind='subscription' order by p.created_at desc limit 10", [s.id]);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Абонамент</h1>
      <Flash error={e} ok={paid ? 'Благодарим! Плащането се обработва и абонаментът се активира, щом получим потвърждение.' : undefined} />
      <div className={`card ${cur ? '' : 'border-amber-400'}`}>
        {cur ? <p>Активен план <b>{cur.name}</b> до {new Date(cur.period_end).toLocaleDateString('bg-BG')}. {cur.cancel_at_period_end ? 'Няма да се поднови автоматично.' : ''}</p> : <p>Нямате активен план. Профилът ви остава, но услугите не се показват в търсенето и не може да кандидатствате.</p>}
        {cur && !cur.cancel_at_period_end && <form action={cancelRenewalAction} className="mt-3"><button className="btn !min-h-[40px] text-sm">Отмени подновяването</button></form>}
        <p className="mt-2 text-sm text-slate-600">Абонаментът не означава „проверен“ профил. Проверката е отделна.</p>
      </div>
      <div className="grid gap-3">
        {plans.map((p: any) => (
          <form key={p.id} action={checkoutAction} className="card flex items-center justify-between gap-3">
            <input type="hidden" name="kind" value="subscription" /><input type="hidden" name="ref" value={p.id} />
            <div><h2 className="font-display text-lg">{p.name}</h2><p className="text-sm text-slate-600">До {p.active_limit} активни услуги · {eur(p.price_cents)} / месец</p></div>
            <button className="btn btn-primary">{cur?.plan_id === p.id ? 'Поднови' : 'Избери'}</button>
          </form>
        ))}
      </div>
      <p className="text-sm text-slate-500">Правата се активират само след потвърдено плащане от платежния доставчик.</p>
      {pays.length > 0 && <section className="card space-y-2"><h2 className="font-display text-lg">История</h2>
        {pays.map((p: any) => <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-sm first:border-0 first:pt-0"><span>{dt(p.created_at)} · {p.ref} · {eur(p.amount_cents)}</span><span className="flex gap-2">{p.number && <span className="text-slate-500">{p.number}</span>}<Pill tone={p.status === 'paid' ? 'good' : p.status === 'failed' ? 'bad' : 'spons'}>{p.status === 'paid' ? 'Платено' : p.status === 'failed' ? 'Неуспешно' : 'Чака плащане'}</Pill></span></div>)}</section>}
    </div>
  );
}
