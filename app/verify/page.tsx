import Link from 'next/link';
import { verifyAction } from '../actions';
import { Flash } from '@/components/Flash';

export const metadata = { title: 'Потвърждение на имейл' };
// Потвърждението е POST, а не GET: пощенски скенери и prefetch не бива да изразходват токена.
export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string; e?: string; done?: string }> }) {
  const { token, e, done } = await searchParams;
  return (
    <div className="card space-y-4">
      <h1 className="font-display text-2xl">Потвърждение на имейл</h1>
      {done && <><Flash ok="Имейлът е потвърден." /><Link href="/dashboard" className="btn btn-primary">Към таблото</Link></>}
      {!done && <Flash error={e} />}
      {!done && token && <form action={verifyAction}><input type="hidden" name="token" value={token} /><button className="btn btn-primary w-full">Потвърди имейла</button></form>}
      {!done && !token && !e && <p>Отворете линка от писмото, което ви изпратихме.</p>}
    </div>
  );
}
