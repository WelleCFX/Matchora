import { forgotAction } from '../actions';
import { Flash } from '@/components/Flash';

export const metadata = { title: 'Забравена парола' };
export default async function Forgot({ searchParams }: { searchParams: Promise<{ e?: string; sent?: string }> }) {
  const { e, sent } = await searchParams;
  return (
    <div className="card space-y-4">
      <h1 className="font-display text-2xl">Възстановяване на парола</h1>
      <Flash error={e} ok={sent ? 'Ако има акаунт с този имейл, изпратихме линк за нова парола.' : undefined} />
      <form action={forgotAction} className="space-y-4">
        <div><label className="label" htmlFor="email">Имейл</label><input id="email" name="email" type="email" className="input" required autoComplete="email" /></div>
        <button className="btn btn-primary w-full">Изпрати линк</button>
      </form>
    </div>
  );
}
