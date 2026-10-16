import type { PoolClient } from 'pg';
import { q } from './db';

export type CreditType = 'purchase' | 'debit_application' | 'hold_boost' | 'release_boost' | 'settle_boost' | 'refund' | 'admin_adjustment' | 'debit_promotion' | 'promo_refund';
/** [Δналични, Δрезервирани] */
const EFFECT: Record<CreditType, (a: number) => [number, number]> = {
  purchase: (a) => [a, 0], admin_adjustment: (a) => [a, 0], promo_refund: (a) => [a, 0], debit_application: (a) => [-a, 0], refund: (a) => [-a, 0], debit_promotion: (a) => [-a, 0],
  hold_boost: (a) => [-a, a], release_boost: (a) => [a, -a], settle_boost: (a) => [0, -a],
};
export class CreditError extends Error {}

/**
 * Единствената входна точка за движение на кредити. Вика се винаги вътре в транзакция.
 * Идемпотентна по `key`: повторение връща 'dup' и не променя баланса.
 * Редът на портфейла се заключва, така че едновременни операции се подреждат една след друга.
 */
export async function creditOp(c: PoolClient, o: { userId: string; type: CreditType; amount: number; key: string; related?: string; actor?: string | null; note?: string }): Promise<'ok' | 'dup'> {
  if (!Number.isInteger(o.amount) || o.amount === 0 || (o.type !== 'admin_adjustment' && o.amount < 0)) throw new CreditError('Невалидна сума');
  await c.query('insert into credit_wallets(user_id) values ($1) on conflict do nothing', [o.userId]);
  const w = (await c.query('select available, reserved from credit_wallets where user_id=$1 for update', [o.userId])).rows[0];
  const dup = await c.query('select 1 from credit_transactions where idempotency_key=$1', [o.key]);
  if (dup.rowCount) return 'dup';
  const [da, dr] = EFFECT[o.type](o.amount);
  if (w.available + da < 0 || w.reserved + dr < 0) throw new CreditError('Недостатъчен кредитен баланс');
  await c.query('insert into credit_transactions(user_id,type,amount,related,idempotency_key,actor_id,note) values ($1,$2,$3,$4,$5,$6,$7)',
    [o.userId, o.type, o.amount, o.related ?? null, o.key, o.actor ?? null, o.note ?? null]);
  await c.query('update credit_wallets set available=available+$2, reserved=reserved+$3 where user_id=$1', [o.userId, da, dr]);
  return 'ok';
}

export async function getWallet(userId: string) {
  const r = (await q<{ available: number; reserved: number }>('select available, reserved from credit_wallets where user_id=$1', [userId]))[0];
  return r ?? { available: 0, reserved: 0 };
}
