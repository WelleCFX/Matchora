import { q } from '@/lib/db';
import { requireProvider } from '@/lib/guard';
import { getWallet } from '@/lib/credits';
import { eur, dt } from '@/lib/format';
import { checkoutAction } from '../actions/billing';
import { Flash } from '@/components/Flash';

export const metadata = { title: 'Кредити' };
const T: Record<string, string> = { purchase: 'Покупка', debit_application: 'Кандидатстване', hold_boost: 'Резервиран boost', release_boost: 'Освободен boost', settle_boost: 'Таксуван boost', refund: 'Възстановяване', admin_adjustment: 'Корекция' };
export default async function Credits({ searchParams }: { searchParams: Promise<{ e?: string; paid?: string }> }) {
  const s = await requireProvider(); const { e, paid } = await searchParams;
  const w = await getWallet(s.id);
  const pk = await q('select * from credit_packages where is_active order by credits');
  const tx = await q('select * from credit_transactions where user_id=$1 order by id desc limit 50', [s.id]);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Кредити</h1>
      <Flash error={e} ok={paid ? 'Благодарим! Кредитите се добавят, щом получим потвърждение за плащането.' : undefined} />
      <div className="grid grid-cols-2 gap-3">
        <div className="card"><p className="font-display text-3xl">{w.available}</p><p className="text-sm text-slate-600">Налични</p></div>
        <div className="card"><p className="font-display text-3xl">{w.reserved}</p><p className="text-sm text-slate-600">Резервирани за boost</p></div>
      </div>
      <p className="rounded-xl bg-teal-soft p-3 text-sm text-slate-900">Кредитите са вътрешна единица за функциите на Matchora. Не са пари и не се теглят.</p>
      <div className="grid gap-3">{pk.map((p: any) => (
        <form key={p.id} action={checkoutAction} className="card flex items-center justify-between gap-3"><input type="hidden" name="kind" value="credits" /><input type="hidden" name="ref" value={p.id} />
          <div><h2 className="font-display text-lg">{p.credits} кредита</h2><p className="text-sm text-slate-600">{eur(p.price_cents)}</p></div><button className="btn btn-primary">Купи</button></form>))}</div>
      <section className="space-y-2"><h2 className="font-display text-lg">История</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-900"><table className="w-full"><thead><tr className="text-left text-slate-500"><th className="p-2">Време</th><th className="p-2">Тип</th><th className="p-2">Кредити</th></tr></thead>
          <tbody>{tx.map((t: any) => <tr key={t.id} className="border-t border-slate-100 dark:border-slate-700"><td className="whitespace-nowrap p-2">{dt(t.created_at)}</td><td className="whitespace-nowrap p-2">{T[t.type]}</td><td className="p-2 tabular-nums">{t.amount}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
