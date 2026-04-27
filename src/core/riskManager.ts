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
 * Returns true when the order is within all configured risk limits.
 * Does NOT mutate exposure — call updateExposure() after a successful execution.
 */
export async function validateTrade(trade: TradeEvent, orderSize: number): Promise<boolean> {
  if (orderSize > MAX_PER_TRADE) {
    logger.debug(
      `[riskManager] Rejected: exceeds per trade limit — ` +
      `orderSize=${orderSize} > MAX_PER_TRADE=${MAX_PER_TRADE} [id=${trade.id}]`,
    );
    return false;
  }

  const totalExposure = await readExposure(TOTAL_EXPOSURE_KEY);
  if (totalExposure + orderSize > MAX_TOTAL_EXPOSURE) {
    logger.warn(
      `[riskManager] Rejected: exceeds total exposure — ` +
      `would reach ${totalExposure + orderSize} > MAX_TOTAL_EXPOSURE=${MAX_TOTAL_EXPOSURE} [id=${trade.id}]`,
    );
    return false;
  }

  const marketExposure = await readExposure(marketKey(trade.market));
  if (marketExposure + orderSize > MAX_PER_MARKET) {
    logger.warn(
      `[riskManager] Rejected: exceeds market exposure — ` +
      `market=${trade.market} would reach ${marketExposure + orderSize}` +
      ` > MAX_PER_MARKET=${MAX_PER_MARKET} [id=${trade.id}]`,
    );
    return false;
  }

  logger.debug(
    `[riskManager] Accepted: within risk limits — orderSize=${orderSize} [id=${trade.id}]`,
  );
  return true;
}

/**
 * Increments total and per-market exposure counters in Redis after a successful execution.
 * Errors are logged as warnings and do not propagate — the order is already placed.
 */
export async function updateExposure(orderSize: number, market: string): Promise<void> {
  try {
    await redis.incrbyfloat(TOTAL_EXPOSURE_KEY, orderSize);
    await redis.incrbyfloat(marketKey(market), orderSize);
    logger.debug(`[riskManager] Exposure updated: +${orderSize} on market ${market}`);
  } catch (err) {
    logger.warn(
      '[riskManager] Failed to update exposure in Redis',
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

/** Returns total exposure snapshot for monitoring or Telegram /stats. */
export async function getExposureSummary(): Promise<number> {
  return readExposure(TOTAL_EXPOSURE_KEY);
}
