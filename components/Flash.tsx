export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <p role="alert" data-flash className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>;
  if (ok) return <p role="status" data-flash className="rounded-xl bg-teal-soft px-4 py-3 text-sm text-slate-900">{ok}</p>;
  return null;
}
