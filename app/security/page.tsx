import { cookies } from 'next/headers';
import QRCode from 'qrcode';
import { q } from '@/lib/db';
import { requireUser } from '@/lib/guard';
import { pendingSetup, remainingCodes } from '@/lib/twofactor';
import { confirmTotpAction, disableTotpAction, dismissCodesAction, regenerateCodesAction, startTotpAction } from '../actions';
import { Flash } from '@/components/Flash';

export const metadata = { title: 'Сигурност' };
export default async function Security({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const s = await requireUser(); const { e } = await searchParams;
  const codes = (await cookies()).get('mt_codes')?.value?.split(' ');
  const setup = s.twoFactor ? null : await pendingSetup(s.id, s.email);
  const qr = setup ? await QRCode.toDataURL(setup.uri, { margin: 1, width: 220 }) : null;
  const left = s.twoFactor ? await remainingCodes(s.id) : 0;
  void q;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Сигурност на акаунта</h1>
      <Flash error={e} />
      {s.staffRole !== 'none' && !s.twoFactor && <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-950">Като служител нямате достъп до администрацията, докато не включите двуфакторна автентикация.</p>}
      {codes && (
        <section className="card space-y-3 border-teal">
          <h2 className="font-display text-lg">Кодове за възстановяване</h2>
          <p className="text-sm">Запазете ги на сигурно място. Всеки важи веднъж и се показват само сега.</p>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm">{codes.map((c) => <span key={c} className="rounded-lg bg-slate-100 px-2 py-1 text-slate-900">{c}</span>)}</div>
          <form action={dismissCodesAction}><button className="btn btn-primary w-full">Запазих ги</button></form>
        </section>)}
      {!s.twoFactor && !setup && (
        <section className="card space-y-3"><h2 className="font-display text-lg">Двуфакторна автентикация</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">Допълнителен код от приложение като Google Authenticator или Aegis при всеки вход.</p>
          <form action={startTotpAction}><button className="btn btn-primary w-full">Включи</button></form></section>)}
      {setup && (
        <section className="card space-y-3"><h2 className="font-display text-lg">Сканирайте и потвърдете</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr!} alt="QR код за приложението за удостоверяване" width={220} height={220} className="mx-auto rounded-lg bg-white" />
          <p className="break-all text-center font-mono text-sm">{setup.secret}</p>
          <form action={confirmTotpAction} className="space-y-3"><input name="code" className="input" inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="6-цифрен код" required aria-label="Код" /><button className="btn btn-primary w-full">Потвърди и включи</button></form></section>)}
      {s.twoFactor && (<>
        <section className="card space-y-2"><h2 className="font-display text-lg">2FA е включена</h2><p className="text-sm text-slate-600 dark:text-slate-300">Оставащи кодове за възстановяване: {left}.</p></section>
        <form action={regenerateCodesAction} className="card space-y-3"><h2 className="font-display text-lg">Нови кодове за възстановяване</h2><input name="password" type="password" className="input" placeholder="Парола" required autoComplete="current-password" aria-label="Парола" /><button className="btn w-full">Генерирай нови</button></form>
        {s.staffRole === 'none' && <form action={disableTotpAction} className="card space-y-3"><h2 className="font-display text-lg">Изключване</h2><input name="password" type="password" className="input" placeholder="Парола" required aria-label="Парола" /><input name="code" className="input" placeholder="Код" required aria-label="Код" /><button className="btn w-full border-red-400 text-red-700">Изключи 2FA</button></form>}
      </>)}
    </div>
  );
}
