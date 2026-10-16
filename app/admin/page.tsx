import { reviewCompanyAction } from '../actions/company';
import { q } from '@/lib/db';
import { requireStaff } from '@/lib/guard';
import { approveJobAction, rejectJobAction, adminCancelJobAction, removeListingAction, resolveReportAction, dismissReportAction, clawbackCreditsAction, dismissPaymentReviewAction } from '../actions/admin';
import { Flash } from '@/components/Flash';
import { dt, eur } from '@/lib/format';

export const metadata = { title: 'Админ' };
export default async function Admin({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const s = await requireStaff('moderator'); const { e } = await searchParams;
  const [k] = await q(`select
    (select count(*)::int from users) users,
    (select count(*)::int from subscriptions where status='active' and period_end>now()) providers,
    (select coalesce(sum(p.price_cents),0)::int from subscriptions sb join plans p on p.id=sb.plan_id where sb.status='active' and sb.period_end>now()) mrr,
    (select count(*)::int from jobs where status='open') jobs,
    (select count(*)::int from proposals) proposals,
    (select coalesce(sum(available),0)::int from credit_wallets) credits_avail,
    (select coalesce(sum(reserved),0)::int from credit_wallets) credits_res,
    (select count(*)::int from payments where status='pending') pending_pay`);
  const pending = await q("select j.*, u.email from jobs j join users u on u.id=j.client_id where j.status='pending_review' order by j.created_at");
  const reports = await q("select * from reports where status='open' order by id");
  const refunds = s.staffRole === 'admin' ? await q("select p.*, pr.display_name from payments p join profiles pr on pr.user_id=p.user_id where p.status in ('refunded','disputed') and (p.review_note is null or p.review_note like 'Чака%') order by p.created_at") : [];
  const companies = await q("select c.*, u.email from companies c join users u on u.id=c.owner_id where c.verification_status='pending' order by c.created_at");
  const audit = await q('select * from audit_logs order by id desc limit 25');
  const Kpi = ({ v, l }: { v: string | number; l: string }) => <div className="card"><p className="font-display text-2xl">{v}</p><p className="text-xs text-slate-600">{l}</p></div>;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Административно табло</h1><Flash error={e} />
      <div className="grid grid-cols-2 gap-3"><Kpi v={k.users} l="Потребители" /><Kpi v={k.providers} l="Платени изпълнители" /><Kpi v={eur(k.mrr)} l="MRR" /><Kpi v={k.jobs} l="Отворени задания" /><Kpi v={k.proposals} l="Оферти" /><Kpi v={`${k.credits_avail} / ${k.credits_res}`} l="Кредити: налични / резервирани" /><Kpi v={k.pending_pay} l="Чакащи плащания" /></div>
      <section className="space-y-2"><h2 className="font-display text-lg">Задания за преглед</h2>
        {pending.length === 0 && <div className="card text-slate-600">Няма. Задание с забранена фраза (например „казино“) влиза тук автоматично.</div>}
        {pending.map((j: any) => <div key={j.id} className="card space-y-2"><h3 className="font-semibold">{j.title}</h3><p className="text-sm">{j.description}</p><p className="text-xs text-slate-500">{j.email}</p>
          <form className="flex flex-wrap gap-2"><input type="hidden" name="jobId" value={j.id} /><input name="note" className="input" placeholder="Бележка при отказ" /><button formAction={approveJobAction} className="btn btn-primary">Одобри</button><button formAction={rejectJobAction} className="btn">Откажи</button></form></div>)}</section>
      <section className="space-y-2"><h2 className="font-display text-lg">Сигнали</h2>
        {reports.length === 0 && <div className="card text-slate-600">Няма отворени сигнали.</div>}
        {reports.map((r: any) => <div key={r.id} className="card space-y-2"><p className="text-sm"><b>{r.target_type}</b> {r.target_id}</p><p>{r.reason}</p>
          <form className="flex flex-wrap gap-2"><input type="hidden" name="reportId" value={r.id} /><input name="resolution" className="input" placeholder="Решение" />
            <button formAction={resolveReportAction} className="btn btn-primary">Реши</button><button formAction={dismissReportAction} className="btn">Отхвърли</button></form>
          {r.target_type === 'listing' && <form action={removeListingAction}><input type="hidden" name="listingId" value={r.target_id} /><button className="btn border-red-400 text-red-700">Премахни услугата</button></form>}
          {r.target_type === 'job' && <form action={adminCancelJobAction}><input type="hidden" name="jobId" value={r.target_id} /><button className="btn border-red-400 text-red-700">Откажи заданието</button></form>}</div>)}</section>
      {companies.length > 0 && <section className="space-y-2"><h2 className="font-display text-lg">Фирми за проверка</h2>
        {companies.map((c: any) => <form key={c.id} className="card space-y-2"><input type="hidden" name="companyId" value={c.id} />
          <p><b>{c.legal_name}</b> · ЕИК {c.eik}{c.vat_number ? ` · ${c.vat_number}` : ''}</p><p className="text-sm text-slate-600">{c.email}{c.address ? ` · ${c.address}` : ''} — сверете със Търговския регистър (portal.registryagency.bg).</p>
          <input name="note" className="input" placeholder="Причина (задължителна при отказ)" aria-label="Причина" />
          <div className="flex gap-2"><button name="decision" value="approve" formAction={async (f: FormData) => { 'use server'; f.set('decision', 'approve'); await reviewCompanyAction(f); }} className="btn btn-primary">Потвърди</button>
          <button formAction={async (f: FormData) => { 'use server'; f.set('decision', 'reject'); await reviewCompanyAction(f); }} className="btn">Откажи</button></div></form>)}</section>}
      {refunds.length > 0 && <section className="space-y-2"><h2 className="font-display text-lg">Възстановени плащания за преглед</h2>
        {refunds.map((p: any) => <div key={p.id} className="card space-y-2"><p><b>{p.display_name}</b> · {p.kind} {p.ref} · {p.status === 'refunded' ? 'възстановено' : 'спор'}</p>
          <form className="flex gap-2"><input type="hidden" name="paymentId" value={p.id} />{p.kind === 'credits' && <button formAction={clawbackCreditsAction} className="btn btn-primary">Приспадни кредитите (до наличното)</button>}<button formAction={dismissPaymentReviewAction} className="btn">Без корекция</button></form></div>)}</section>}
      <section className="space-y-2"><h2 className="font-display text-lg">Одит</h2><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-900"><table className="w-full"><tbody>
        {audit.map((a: any) => <tr key={a.id} className="border-t border-slate-100 first:border-0 dark:border-slate-700"><td className="whitespace-nowrap p-2">{dt(a.created_at)}</td><td className="whitespace-nowrap p-2">{a.action}</td><td className="p-2 text-xs text-slate-500">{JSON.stringify(a.metadata)}</td></tr>)}</tbody></table></div></section>
      <span className="hidden">{s.id}</span>
    </div>
  );
}
