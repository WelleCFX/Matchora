import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/guard';
import { Flash } from '@/components/Flash';
import { joinAction } from '../../actions/company';
export const metadata = { title: 'Покана за екип' };
export default async function Join({ searchParams }: { searchParams: Promise<{ token?: string; e?: string }> }) {
  const { token, e } = await searchParams;
  if (!token) redirect('/dashboard');
  await requireUser();     // при липса на сесия -> /login (след вход отворете линка отново)
  return (
    <div className="mx-auto max-w-md space-y-4"><h1 className="font-display text-2xl">Покана за екип</h1><Flash error={e} />
      <form action={joinAction} className="card space-y-3"><input type="hidden" name="token" value={token} />
        <p>Приемете поканата, за да работите от името на фирмата. Трябва да сте влезли с поканения имейл.</p>
        <button className="btn btn-primary w-full">Приеми поканата</button></form></div>
  );
}
