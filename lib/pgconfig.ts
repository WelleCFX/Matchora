/** Конфигурация на връзката към Postgres. Управляваните бази (Supabase, Neon) изискват TLS; ако URL-ът носи sslmode, включваме TLS без строга проверка на веригата (сертификатите им не са в хранилището на Node). */
export function pgConfig(url: string) {
  let ssl: false | { rejectUnauthorized: boolean } = false;
  let conn = url;
  try {
    const u = new URL(url);
    const mode = u.searchParams.get('sslmode');
    if (mode && mode !== 'disable') ssl = { rejectUnauthorized: false };
    u.searchParams.delete('sslmode');
    conn = u.toString();
  } catch { /* необичаен формат – ползва се както е */ }
  return { connectionString: conn, ssl };
}
