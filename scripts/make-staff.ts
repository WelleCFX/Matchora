// Употреба: npm run make-staff -- имейл admin|moderator|support
import { Client } from 'pg';
import { loadEnv } from '../lib/env';
loadEnv();
const [email, role] = process.argv.slice(2);
if (!email || !['admin', 'moderator', 'support'].includes(role)) { console.error('Употреба: make-staff <имейл> <admin|moderator|support>'); process.exit(1); }
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const r = await c.query('update users set staff_role=$2 where email=lower($1) returning id', [email, role]);
  console.log(r.rowCount ? `Готово: ${email} е ${role}` : 'Няма такъв потребител'); await c.end();
})();
