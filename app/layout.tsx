import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { getSession } from '@/lib/auth';
import { logoutAction } from './actions';
import { q } from '@/lib/db';

export const metadata: Metadata = { title: { default: 'Matchora', template: '%s · Matchora' }, description: 'Българската платформа за намиране на изпълнители и услуги.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const unread = s ? (await q('select count(*)::int n from notifications where user_id=$1 and read_at is null', [s.id]))[0].n as number : 0;
  const links: [string, string][] = [['/services', 'Търсене'], ['/jobs', 'Задания']];
  if (s) links.push(['/orders', 'Поръчки'], ['/requests', 'Заявки']);
  if (s?.isProvider) links.push(['/my/services', 'Услуги'], ['/subscription', 'Абонамент'], ['/credits', 'Кредити'], ['/ads', 'Реклами'], ['/company', 'Фирма']);
  if (s && s.staffRole !== 'none') links.push(['/admin', 'Админ']);
  return (
    <html lang="bg">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600&family=Unbounded:wght@500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen">
        <header className="sticky top-0 z-10 bg-navy text-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="font-display text-lg font-semibold tracking-wide">Match<span className="text-[#2CC4D2]">ora</span></Link>
            <nav className="flex items-center gap-2 text-sm">
              {s ? (<>
                <Link href="/notifications" className="rounded-lg px-3 py-2" aria-label="Известия">Известия{unread > 0 && <span className="ml-1 rounded-full bg-teal px-1.5 text-xs">{unread}</span>}</Link>
                <Link href="/profile" className="rounded-lg px-3 py-2">Профил</Link>
                <form action={logoutAction}><button className="rounded-lg border border-white/30 px-3 py-2">Изход</button></form>
              </>) : (<>
                <Link href="/login" className="rounded-lg px-3 py-2">Вход</Link>
                <Link href="/register" className="rounded-lg bg-teal px-3 py-2 font-medium">Регистрация</Link>
              </>)}
            </nav>
          </div>
          <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-3 pb-2 text-sm">{[['/dashboard', 'Табло'] as [string, string], ...links].map(([h, t]) => <Link key={h} href={h} className="whitespace-nowrap rounded-lg px-3 py-2 text-slate-200">{t}</Link>)}</nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">{children}</main>
      </body>
    </html>
  );
}
