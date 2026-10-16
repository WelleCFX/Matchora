import { pgConfig } from './pgconfig';
import { Pool, type PoolClient } from 'pg';

const g = globalThis as unknown as { __pool?: Pool };
export function pool(): Pool {
  if (!g.__pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL липсва');
    g.__pool = new Pool({ ...pgConfig(process.env.DATABASE_URL), max: Number(process.env.DB_POOL_MAX || (process.env.VERCEL ? 3 : 10)) });
  }
  return g.__pool;
}
export async function q<T = any>(text: string, params: unknown[] = []) {
  return (await pool().query(text, params)).rows as T[];
}
/** Изпълнява функцията в една атомарна транзакция. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
