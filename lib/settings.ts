import type { PoolClient } from 'pg';
import { q } from './db';
export type BidSettings = { app_cost: number; min_boost: number; step: number; slots: number };
export async function getBidSettings(c?: PoolClient): Promise<BidSettings> {
  const r = c ? (await c.query("select value from app_settings where key='bids'")).rows : await q("select value from app_settings where key='bids'");
  return r[0].value as BidSettings;
}
