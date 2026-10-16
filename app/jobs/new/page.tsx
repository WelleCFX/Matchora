import { q } from '@/lib/db';
import { requireVerified } from '@/lib/guard';
import { createJobAction } from '../../actions/jobs';
import { CITIES } from '@/lib/validation';
import { Flash } from '@/components/Flash';

export const metadata = { title: 'Ново задание' };
export default async function NewJob({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  await requireVerified(); const { e } = await searchParams;
  const cats = await q('select id, name from categories order by sort');
  return (
    <form action={createJobAction} className="card space-y-4">
      <h1 className="font-display text-2xl">Ново задание</h1>
      <p className="text-sm text-slate-600">Публикуването е безплатно. Заданието се проверява автоматично и при нужда от модератор.</p>
      <Flash error={e} />
      <div><label className="label" htmlFor="title">Заглавие</label><input id="title" name="title" className="input" required minLength={8} maxLength={120} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="categoryId">Категория</label><select id="categoryId" name="categoryId" className="input">{cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="city">Град</label><select id="city" name="city" className="input">{CITIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label className="label" htmlFor="budgetMin">Бюджет от, €</label><input id="budgetMin" name="budgetMin" type="number" min="1" step="0.01" className="input" required /></div>
        <div><label className="label" htmlFor="budgetMax">Бюджет до, €</label><input id="budgetMax" name="budgetMax" type="number" min="1" step="0.01" className="input" required /></div>
      </div>
      <div><label className="label" htmlFor="deadline">Краен срок за кандидатстване</label><input id="deadline" name="deadline" type="date" className="input" required /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remote" /> Може да се изпълни дистанционно</label>
      <div><label className="label" htmlFor="description">Описание</label><textarea id="description" name="description" className="input min-h-[140px]" required minLength={20} maxLength={3000} /></div>
      <button className="btn btn-primary w-full">Публикувай</button>
    </form>
  );
}
