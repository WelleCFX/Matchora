import Link from 'next/link';
import { requireStaff } from '@/lib/guard';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff('support');
  return (<div className="space-y-4"><nav className="flex gap-2 overflow-x-auto text-sm">{[['/admin', 'Табло и модерация'], ['/admin/ads', 'Реклами'], ['/admin/ledger', 'Ledger'], ['/admin/users', 'Потребители'], ['/admin/settings', 'Настройки']].map(([h, t]) => <Link key={h} href={h} className="btn !min-h-[40px] whitespace-nowrap">{t}</Link>)}</nav><p className="text-xs text-slate-500">Роля: {s.staffRole}</p>{children}</div>);
}
