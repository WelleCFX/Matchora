import { q } from '@/lib/db';
import { requireStaff } from '@/lib/guard';
import { adjustCreditsAction } from '../../actions/admin';
import { Flash } from '@/components/Flash';
import { dt } from '@/lib/format';

export const metadata = { title: 'Ledger' };
export default async function Ledger({ searchParams }: { searchParams: Promise<{ e?: string; user?: string }> }) {
  const s = await requireStaff('support'); const { e, user } = await searchParams;
  const rows = await q(`select t.*, p.display_name from credit_transactions t join profiles p on p.user_id=t.user_id ${user ? 'where t.user_id::text=$1 or t.related=$1' : ''} order by t.id desc limit 100`, user ? [user] : []);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Кредитен ledger</h1><Flash error={e} />
      <p className="text-sm text-slate-600">Само за добавяне: базата отказва промяна и изтриване. Корекциите изискват причина и се записват в одита.</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-900"><table className="w-full"><thead><tr className="text-left text-slate-500"><th className="p-2">Време</th><th className="p-2">Потребител</th><th className="p-2">Тип</th><th className="p-2">Кр.</th><th className="p-2">Ключ</th></tr></thead>
        <tbody>{rows.map((t: any) => <tr key={t.id} className="border-t border-slate-100 dark:border-slate-700"><td className="whitespace-nowrap p-2">{dt(t.created_at)}</td><td className="whitespace-nowrap p-2">{t.display_name}</td><td className="whitespace-nowrap p-2">{t.type}</td><td className="p-2 tabular-nums">{t.amount}</td><td className="whitespace-nowrap p-2 text-xs text-slate-500">{t.idempotency_key}</td></tr>)}</tbody></table></div>
      {s.staffRole === 'admin' && <form action={adjustCreditsAction} className="card space-y-3"><h2 className="font-display text-lg">Ръчна корекция</h2>
        <input name="userId" className="input" placeholder="ID на потребител" required aria-label="ID на потребител" /><input name="amount" type="number" className="input" placeholder="Кредити (+/−)" required aria-label="Кредити" /><input name="reason" className="input" placeholder="Причина" required minLength={5} aria-label="Причина" /><button className="btn btn-primary w-full">Запиши</button></form>}
    </div>
  );
}
