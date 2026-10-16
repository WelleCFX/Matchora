import Link from 'next/link';
import { q } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { eur, d0, STATUS_BG } from '@/lib/format';
import { Pill } from '@/components/ui';

export const metadata = { title: 'Задания' };
export default async function Jobs({ searchParams }: { searchParams: Promise<{ category?: string; city?: string; mine?: string }> }) {
  const s = await getSession(); const sp = await searchParams;
  const cats = await q('select slug, name from categories order by sort');
  const params: unknown[] = [s?.id ?? null];
  let where = `(j.status='open' and j.deadline >= current_date)`;
  if (sp.mine && s) where = 'j.client_id=$1';
  if (sp.category) { params.push(sp.category); where += ` and c.slug=$${params.length}`; }
  if (sp.city) { params.push(sp.city); where += ` and (j.city=$${params.length} or j.remote)`; }
  const rows = await q(`select j.*, c.name category, (select count(*)::int from proposals p where p.job_id=j.id and p.status='submitted') offers
      from jobs j join categories c on c.id=j.category_id where ${where} order by j.created_at desc limit 60`, params);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2"><h1 className="font-display text-2xl">Задания</h1>{s && <Link href="/jobs/new" className="btn btn-primary">Ново задание</Link>}</div>
      <form className="grid grid-cols-2 gap-3" action="/jobs">
        <select name="category" defaultValue={sp.category ?? ''} className="input" aria-label="Категория"><option value="">Всички категории</option>{cats.map((c: any) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
        <button className="btn">Филтрирай</button>
      </form>
      {s && <p className="text-sm"><Link href={sp.mine ? '/jobs' : '/jobs?mine=1'} className="text-teal underline">{sp.mine ? 'Всички отворени задания' : 'Само моите задания'}</Link></p>}
      {rows.length === 0 && <div className="card text-slate-600">Няма задания по тези критерии.</div>}
      {rows.map((j: any) => (
        <Link key={j.id} href={`/jobs/${j.id}`} className="card block space-y-1">
          <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{j.title}</h2><Pill tone={j.status === 'open' ? 'good' : 'neutral'}>{STATUS_BG[j.status]}</Pill></div>
          <p className="text-sm text-slate-600">{j.category} · {j.city}{j.remote ? ' / дистанционно' : ''} · срок {d0(j.deadline)}</p>
          <p className="flex justify-between"><span className="font-display">{eur(j.budget_min_cents)} – {eur(j.budget_max_cents)}</span><span className="text-sm text-slate-600">{j.offers} оферти</span></p>
        </Link>))}
    </div>
  );
}
