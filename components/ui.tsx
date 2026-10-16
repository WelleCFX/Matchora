import Link from 'next/link';
export const Pill = ({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'spons' | 'bad' }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone === 'good' ? 'bg-emerald-100 text-emerald-900' : tone === 'spons' ? 'bg-amber-100 text-amber-900' : tone === 'bad' ? 'bg-red-100 text-red-900' : 'bg-slate-100 text-slate-700'}`}>{children}</span>
);
export const Btn = ({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) => <Link href={href} className={`btn ${primary ? 'btn-primary' : ''}`}>{children}</Link>;
export const Field = ({ label, id, children }: { label: string; id: string; children: React.ReactNode }) => <div><label className="label" htmlFor={id}>{label}</label>{children}</div>;
