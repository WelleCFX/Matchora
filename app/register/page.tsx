import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { registerAction } from '../actions';
import { Flash } from '@/components/Flash';

export const metadata = { title: 'Регистрация' };
export default async function Register({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await getSession()) redirect('/dashboard');
  const { e } = await searchParams;
  return (
    <div className="card space-y-4">
      <h1 className="font-display text-2xl">Регистрация</h1>
      <Flash error={e} />
      <form action={registerAction} className="space-y-4">
        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="label">Как ще използвате Matchora?</legend>
          <label className="card flex min-h-[56px] cursor-pointer items-center gap-2 has-[:checked]:border-teal"><input type="radio" name="accountType" value="client" defaultChecked /> Търся услуга</label>
          <label className="card flex min-h-[56px] cursor-pointer items-center gap-2 has-[:checked]:border-teal"><input type="radio" name="accountType" value="provider" /> Предлагам услуги</label>
        </fieldset>
        <div><label className="label" htmlFor="displayName">Име или фирма</label><input id="displayName" name="displayName" className="input" required minLength={2} maxLength={80} autoComplete="name" /></div>
        <div><label className="label" htmlFor="email">Имейл</label><input id="email" name="email" type="email" className="input" required autoComplete="email" /></div>
        <div><label className="label" htmlFor="password">Парола (поне 10 символа)</label><input id="password" name="password" type="password" className="input" required minLength={10} maxLength={128} autoComplete="new-password" /></div>
        <div><label className="label" htmlFor="confirm">Повторете паролата</label><input id="confirm" name="confirm" type="password" className="input" required minLength={10} autoComplete="new-password" /></div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="terms" className="mt-1 h-5 w-5" required /> <span>Съгласен съм с общите условия и политиката за поверителност. (Окончателните текстове предстоят.)</span></label>
        <button className="btn btn-primary w-full">Създай акаунт</button>
      </form>
      <p className="text-sm">Имате акаунт? <Link href="/login" className="text-teal underline">Вход</Link></p>
    </div>
  );
}
