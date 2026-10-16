import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { loginAction } from '../actions';
import { Flash } from '@/components/Flash';

export const metadata = { title: 'Вход' };
export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  if (await getSession()) redirect('/dashboard');
  const { e, ok } = await searchParams;
  return (
    <div className="card space-y-4">
      <h1 className="font-display text-2xl">Вход</h1>
      <Flash error={ok ? undefined : e} ok={ok ? e : undefined} />
      <form action={loginAction} className="space-y-4">
        <div><label className="label" htmlFor="email">Имейл</label><input id="email" name="email" type="email" className="input" required autoComplete="email" /></div>
        <div><label className="label" htmlFor="password">Парола</label><input id="password" name="password" type="password" className="input" required autoComplete="current-password" /></div>
        <button className="btn btn-primary w-full">Вход</button>
      </form>
      <p className="text-sm"><Link href="/forgot" className="text-teal underline">Забравена парола</Link> · <Link href="/register" className="text-teal underline">Нов акаунт</Link></p>
    </div>
  );
}
