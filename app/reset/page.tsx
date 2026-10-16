import { resetAction } from '../actions';
import { Flash } from '@/components/Flash';

export const metadata = { title: 'Нова парола' };
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string; e?: string }> }) {
  const { token, e } = await searchParams;
  if (!token) return <div className="card"><Flash error="Липсва токен. Поискайте нов линк." /></div>;
  return (
    <div className="card space-y-4">
      <h1 className="font-display text-2xl">Нова парола</h1>
      <Flash error={e} />
      <form action={resetAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div><label className="label" htmlFor="password">Нова парола (поне 10 символа)</label><input id="password" name="password" type="password" className="input" required minLength={10} autoComplete="new-password" /></div>
        <div><label className="label" htmlFor="confirm">Повторете паролата</label><input id="confirm" name="confirm" type="password" className="input" required minLength={10} autoComplete="new-password" /></div>
        <button className="btn btn-primary w-full">Смени паролата</button>
      </form>
    </div>
  );
}
