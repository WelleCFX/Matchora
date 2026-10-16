export const eur = (cents: number | null | undefined) => ((cents ?? 0) / 100).toLocaleString('bg-BG', { style: 'currency', currency: 'EUR' });
export const dt = (d: string | Date) => new Date(d).toLocaleString('bg-BG', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
export const d0 = (d: string | Date) => new Date(d).toLocaleDateString('bg-BG');
export const priceText = (t: string, c: number | null) => (t === 'negotiable' ? 'По договаряне' : (t === 'from' ? 'от ' : '') + eur(c));
export const stars = (r: number, n: number) => (n ? `★ ${r.toFixed(1)} (${n})` : 'Без оценки');
export const STATUS_BG: Record<string, string> = { accepted: 'Приета', scheduled: 'Планирана', in_progress: 'В изпълнение', delivered: 'Доставена', completed: 'Завършена', cancelled: 'Отказана', disputed: 'Спорна', open: 'Отворено', closed: 'Затворено', pending_review: 'За преглед', pending: 'Чака отговор', declined: 'Отказана', submitted: 'Подадена', rejected: 'Отхвърлена', withdrawn: 'Оттеглена' };
