import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { loadEnv } from '../lib/env';

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL липсва');
  const c = new Client({ connectionString: url });
  await c.connect();
  // Търсенето разчита на UTF-8 база с локал, който разпознава кирилица (напр. C.UTF-8 или bg_BG.UTF-8).
  const chk = await c.query("select current_setting('server_encoding') enc, to_tsvector('simple','ремонт')::text lex");
  if (chk.rows[0].enc !== 'UTF8' || !chk.rows[0].lex) {
    throw new Error(`Базата трябва да е UTF8 с локал, който разпознава кирилица (сега: ${chk.rows[0].enc}). Създайте я с: CREATE DATABASE matchora ENCODING 'UTF8' LC_COLLATE 'C.utf8' LC_CTYPE 'C.utf8' TEMPLATE template0;`);
  }
  await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = join(process.cwd(), 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const done = await c.query('select 1 from schema_migrations where name=$1', [f]);
    if (done.rowCount) continue;
    await c.query('begin');
    try {
      await c.query(readFileSync(join(dir, f), 'utf8'));
      await c.query('insert into schema_migrations(name) values($1)', [f]);
      await c.query('commit');
      console.log('приложена:', f);
    } catch (e) { await c.query('rollback'); throw e; }
  }
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
