import { TradeEvent } from '../types/tradeEvent';
import logger from '../config/logger';
import { MAX_PER_TRADE, TOTAL_SPEND_LIMIT, MAX_PER_MARKET } from '../config/constants';

// ── In-memory exposure state ──────────────────────────────────────────────────
// Resets on process restart. In a future phase this can be persisted to Redis
// or PostgreSQL so limits survive restarts.

let totalExposure = 0;
const marketExposure = new Map<string, number>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if the trade is within all configured risk limits.
 * Does NOT mutate exposure state — call recordExposure() after a COPY decision.
 */
export function validateTrade(trade: TradeEvent): boolean {
  if (trade.size > MAX_PER_TRADE) {
    logger.debug(
      `[riskManager] Skipped: exceeds per-trade limit — ` +
      `size=${trade.size} > MAX_PER_TRADE=${MAX_PER_TRADE} [id=${trade.id}]`,
    );
    return false;
  }

  if (totalExposure + trade.size > TOTAL_SPEND_LIMIT) {
    logger.warn(
      `[riskManager] Skipped: exceeds risk limit — would reach` +
      ` total=${totalExposure + trade.size} > TOTAL_SPEND_LIMIT=${TOTAL_SPEND_LIMIT}` +
      ` [id=${trade.id}]`,
    );
    return false;
  }

  const currentMarket = marketExposure.get(trade.market) ?? 0;
  if (currentMarket + trade.size > MAX_PER_MARKET) {
    logger.warn(
      `[riskManager] Skipped: exceeds market exposure — ` +
      `market=${trade.market} would reach ${currentMarket + trade.size}` +
      ` > MAX_PER_MARKET=${MAX_PER_MARKET} [id=${trade.id}]`,
    );
    return false;
  }

  return true;
}

/**
 * Increments exposure counters after a COPY decision is confirmed.
 * Must be called exactly once per accepted trade.
 */
export function recordExposure(trade: TradeEvent): void {
  totalExposure += trade.size;
  const newMarket = (marketExposure.get(trade.market) ?? 0) + trade.size;
  marketExposure.set(trade.market, newMarket);

  logger.debug(
    `[riskManager] Exposure updated: total=${totalExposure}` +
    ` market[${trade.market}]=${newMarket}`,
  );
}

/** Returns a snapshot of current exposure for monitoring or Telegram /stats. */
export function getExposureSummary(): { total: number; byMarket: Record<string, number> } {
  return {
    total: totalExposure,
    byMarket: Object.fromEntries(marketExposure),
  };
}

/** Resets all exposure counters. Useful for daily resets or testing. */
export function resetExposure(): void {
  totalExposure = 0;
  marketExposure.clear();
  logger.info('[riskManager] Exposure counters reset');
}
