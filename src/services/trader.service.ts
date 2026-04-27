import { query } from '../infra/db/postgres';
import redis from '../infra/cache/redis';
import logger from '../config/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Trader {
  id: string;
  address: string;
  tag: string | null;
  copy_percentage: string | null; // pg returns NUMERIC as string
  created_at: Date;
}

interface BotStateRow {
  active_trader: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ACTIVE_TRADER_KEY = 'active_trader';

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateAddress(address: string): void {
  if (!ETH_ADDRESS_RE.test(address)) {
    throw new Error(`Invalid Ethereum address: "${address}"`);
  }
}

// ── Service functions ─────────────────────────────────────────────────────────

export async function addTrader(
  address: string,
  tag?: string,
  copyPercentage?: number,
): Promise<Trader> {
  validateAddress(address);

  try {
    const result = await query<Trader>(
      `INSERT INTO traders (address, tag, copy_percentage)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [address, tag ?? null, copyPercentage ?? null],
    );
    const trader = result.rows[0];
    logger.info(`Trader added: ${address}${tag ? ` (${tag})` : ''}`);
    return trader;
  } catch (err: unknown) {
    // PostgreSQL unique-constraint violation
    if ((err as { code?: string }).code === '23505') {
      throw new Error(`Trader already exists: ${address}`);
    }
    throw err;
  }
}

export async function removeTrader(address: string): Promise<void> {
  validateAddress(address);

  // Atomically clear active trader in DB if it matches the removed address
  const cleared = await query<BotStateRow>(
    `UPDATE bot_state
     SET active_trader = NULL
     WHERE id = 1 AND active_trader = $1
     RETURNING active_trader`,
    [address],
  );

  const result = await query(`DELETE FROM traders WHERE address = $1`, [address]);

  if ((result.rowCount ?? 0) === 0) {
    throw new Error(`Trader not found: ${address}`);
  }

  if ((cleared.rowCount ?? 0) > 0) {
    await redis.del(ACTIVE_TRADER_KEY);
    logger.info(`Active trader cleared — ${address} was removed`);
  }

  logger.info(`Trader removed: ${address}`);
}

export async function listTraders(): Promise<Trader[]> {
  const result = await query<Trader>(
    `SELECT * FROM traders ORDER BY created_at ASC`,
  );
  return result.rows;
}

export async function setActiveTrader(address: string): Promise<void> {
  validateAddress(address);

  const exists = await query<Trader>(
    `SELECT id FROM traders WHERE address = $1`,
    [address],
  );

  if ((exists.rowCount ?? 0) === 0) {
    throw new Error(`Cannot set active trader — not found: ${address}`);
  }

  await query(`UPDATE bot_state SET active_trader = $1 WHERE id = 1`, [address]);
  await redis.set(ACTIVE_TRADER_KEY, address);

  logger.info(`Active trader set: ${address}`);
}

export async function updateCopyPercentage(address: string, pct: number): Promise<void> {
  validateAddress(address);

  if (pct < 0 || pct > 100) {
    throw new Error(`Copy percentage must be between 0 and 100, got ${pct}`);
  }

  const result = await query(
    `UPDATE traders SET copy_percentage = $1 WHERE address = $2`,
    [pct, address],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error(`Trader not found: ${address}`);
  }

  logger.info(`Copy percentage updated: ${address} → ${pct}%`);
}

export async function getActiveTrader(): Promise<Trader | null> {
  // 1. Fast path: Redis cache
  const cached = await redis.get(ACTIVE_TRADER_KEY);
  if (cached) {
    const result = await query<Trader>(
      `SELECT * FROM traders WHERE address = $1`,
      [cached],
    );
    if (result.rows[0]) return result.rows[0];
    // Cache is stale — fall through to DB
    await redis.del(ACTIVE_TRADER_KEY);
  }

  // 2. Slow path: DB
  const stateResult = await query<BotStateRow>(
    `SELECT active_trader FROM bot_state WHERE id = 1`,
  );
  const address = stateResult.rows[0]?.active_trader ?? null;
  if (!address) return null;

  const traderResult = await query<Trader>(
    `SELECT * FROM traders WHERE address = $1`,
    [address],
  );
  const trader = traderResult.rows[0] ?? null;

  // Re-populate cache
  if (trader) {
    await redis.set(ACTIVE_TRADER_KEY, address);
  }

  return trader;
}
