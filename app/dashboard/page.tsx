import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { becomeProviderAction, resendVerificationAction, switchModeAction } from '../actions';
import { Flash } from '@/components/Flash';
import Link from 'next/link';

export const metadata = { title: 'Табло' };
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ e?: string; sent?: string }> }) {
  const s = await getSession();
  if (!s) redirect('/login');
  const { e, sent } = await searchParams;
  const provider = s.activeMode === 'provider';
  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl">Здравей, {s.displayName}</h1>
      <Flash error={e} ok={sent ? 'Изпратихме ново писмо за потвърждение.' : undefined} />
      {!s.emailVerified && (
        <div className="card space-y-3 border-amber-400">
          <p>Потвърдете имейла си ({s.email}), за да публикувате задания и услуги.</p>
          <form action={resendVerificationAction}><button className="btn">Изпрати писмото отново</button></form>
        </div>
      )}
      <section className="card space-y-3">
        <h2 className="font-display text-lg">Режим на работа</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">Един акаунт може да е и клиент, и изпълнител. Сега сте: <b>{provider ? 'Изпълнител' : 'Клиент'}</b>.</p>
        <div className="flex flex-wrap gap-3">
          <form action={switchModeAction}><input type="hidden" name="mode" value="client" /><button className="btn" disabled={!provider}>Клиент</button></form>
          {s.isProvider
            ? <form action={switchModeAction}><input type="hidden" name="mode" value="provider" /><button className="btn" disabled={provider}>Изпълнител</button></form>
            : <form action={becomeProviderAction}><button className="btn btn-primary">Активирай профил на изпълнител</button></form>}
        </div>
      </section>
      <section className="card space-y-2">
        <h2 className="font-display text-lg">Бързи действия</h2>
        <div className="flex flex-wrap gap-3">
          {provider ? <><Link href="/my/services" className="btn">Моите услуги</Link><Link href="/jobs" className="btn">Задания за оферти</Link><Link href="/subscription" className="btn">Абонамент</Link><Link href="/credits" className="btn">Кредити</Link></>
            : <><Link href="/jobs/new" className="btn btn-primary">Публикувай задание</Link><Link href="/services" className="btn">Намери услуга</Link><Link href="/orders" className="btn">Поръчки</Link></>}
          <Link href="/profile" className="btn">Профил</Link>
        </div>
      </section>
    </div>
  );
}
