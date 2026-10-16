import { redirect } from 'next/navigation';
import { currentChallenge } from '@/lib/auth';
import { twoFactorLoginAction } from '../../actions';
import { Flash } from '@/components/Flash';

export const metadata = { title: 'Потвърждение при вход' };
export default async function TwoFactor({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (!(await currentChallenge())) redirect('/login');
  const { e } = await searchParams;
  return (
    <div className="card space-y-4">
      <h1 className="font-display text-2xl">Код за вход</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">Въведете 6-цифрения код от приложението за удостоверяване или код за възстановяване.</p>
      <Flash error={e} />
      <form action={twoFactorLoginAction} className="space-y-4">
        <input name="code" className="input" required autoComplete="one-time-code" inputMode="text" autoFocus aria-label="Код" />
        <button className="btn btn-primary w-full">Потвърди</button>
      </form>
    </div>
  );
}
