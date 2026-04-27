import redis from '../infra/cache/redis';
import { TradeEvent } from '../types/tradeEvent';
import logger from '../config/logger';
import { MAX_PER_TRADE, MAX_TOTAL_EXPOSURE, MAX_PER_MARKET } from '../config/constants';

// ── Redis key helpers ─────────────────────────────────────────────────────────

const TOTAL_EXPOSURE_KEY = 'total_exposure';

function marketKey(market: string): string {
  return `market_exposure:${market}`;
}

async function readExposure(key: string): Promise<number> {
  const val = await redis.get(key);
  if (val === null) return 0;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true when the order cost is within all configured risk limits.
 * All limits are denominated in USDC (cost), not shares.
 * Does NOT mutate exposure — call updateExposure() after successful execution.
 */
export async function validateTrade(trade: TradeEvent, cost: number): Promise<boolean> {
  if (cost > MAX_PER_TRADE) {
    logger.debug(
      `[riskManager] Rejected: exceeds per trade limit — ` +
      `cost=$${cost} > MAX_PER_TRADE=$${MAX_PER_TRADE} [id=${trade.id}]`,
    );
    return false;
  }

  const totalExposure = await readExposure(TOTAL_EXPOSURE_KEY);
  if (totalExposure + cost > MAX_TOTAL_EXPOSURE) {
    logger.warn(
      `[riskManager] Rejected: exceeds total exposure — ` +
      `would reach $${totalExposure + cost} > MAX_TOTAL_EXPOSURE=$${MAX_TOTAL_EXPOSURE} [id=${trade.id}]`,
    );
    return false;
  }

  const marketExposure = await readExposure(marketKey(trade.market));
  if (marketExposure + cost > MAX_PER_MARKET) {
    logger.warn(
      `[riskManager] Rejected: exceeds market exposure — ` +
      `market=${trade.market} would reach $${marketExposure + cost}` +
      ` > MAX_PER_MARKET=$${MAX_PER_MARKET} [id=${trade.id}]`,
    );
    return false;
  }

  logger.debug(
    `[riskManager] Accepted: within risk limits — cost=$${cost} [id=${trade.id}]`,
  );
  return true;
}

/**
 * Increments total and per-market USDC exposure counters after a successful execution.
 * Errors are logged as warnings and do not propagate — the order is already placed.
 */
export async function updateExposure(cost: number, market: string): Promise<void> {
  try {
    await redis.incrbyfloat(TOTAL_EXPOSURE_KEY, cost);
    await redis.incrbyfloat(marketKey(market), cost);
    logger.debug(`[riskManager] Exposure updated: +$${cost} USDC on market ${market}`);
  } catch (err) {
    logger.warn(
      '[riskManager] Failed to update exposure in Redis',
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

/** Returns total USDC exposure snapshot for monitoring or Telegram /stats. */
export async function getExposureSummary(): Promise<number> {
  return readExposure(TOTAL_EXPOSURE_KEY);
}
