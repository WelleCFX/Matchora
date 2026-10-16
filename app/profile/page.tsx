import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { q } from '@/lib/db';
import { updateProfileAction } from '../actions';
import { Flash } from '@/components/Flash';
import { CATEGORIES, CITIES } from '@/lib/validation';

export const metadata = { title: 'Профил' };
export default async function Profile({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const s = await getSession();
  if (!s) redirect('/login');
  const { e, ok } = await searchParams;
  const pp = s.isProvider ? (await q('select * from provider_profiles where user_id=$1', [s.id]))[0] : null;
  return (
    <div className="card space-y-4">
      <h1 className="font-display text-2xl">Профил</h1>
      <Flash error={e} ok={ok ? 'Профилът е запазен.' : undefined} />
      <p className="text-sm"><Link href="/security" className="text-teal underline">Сигурност и двуфакторна автентикация</Link>{s.twoFactor ? ' (включена)' : ''}</p>
      <form action={updateProfileAction} className="space-y-4">
        <div><label className="label" htmlFor="displayName">Име или фирма</label><input id="displayName" name="displayName" defaultValue={s.displayName} className="input" required minLength={2} maxLength={80} /></div>
        <div><label className="label" htmlFor="city">Град</label>
          <select id="city" name="city" defaultValue={s.city ?? ''} className="input"><option value="">Изберете</option>{CITIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label className="label" htmlFor="bio">Кратко описание</label><textarea id="bio" name="bio" defaultValue={s.bio ?? ''} className="input min-h-[96px]" maxLength={1000} /></div>
        <div><label className="label" htmlFor="phone">Телефон (скрит по подразбиране)</label><input id="phone" name="phone" defaultValue={s.phone ?? ''} className="input" inputMode="tel" maxLength={24} /></div>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="phonePublic" defaultChecked={s.phonePublic} className="h-5 w-5" /> Показвай телефона публично в профила ми</label>
        {pp && <fieldset className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700">
          <legend className="font-display text-lg">Профил на изпълнител</legend>
          <div><label className="label" htmlFor="businessName">Фирмено име</label><input id="businessName" name="businessName" defaultValue={pp.business_name ?? ''} className="input" maxLength={120} /></div>
          <div><label className="label" htmlFor="category">Основна категория</label>
            <select id="category" name="category" defaultValue={pp.category ?? ''} className="input"><option value="">Изберете</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label" htmlFor="serviceArea">Обслужван район</label><input id="serviceArea" name="serviceArea" defaultValue={pp.service_area ?? ''} className="input" maxLength={160} /></div>
          <div><label className="label" htmlFor="workHours">Работно време</label><input id="workHours" name="workHours" defaultValue={pp.work_hours ?? ''} className="input" maxLength={160} /></div>
          <p className="text-sm text-slate-500">Статус на проверка: {pp.verification_status === 'verified' ? 'Проверен' : 'Непроверен'}. Платеният план не означава „проверен“.</p>
        </fieldset>}
        <button className="btn btn-primary w-full">Запази</button>
      </form>
    </div>
  );
}
