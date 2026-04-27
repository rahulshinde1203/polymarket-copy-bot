import { TradeEvent } from '../types/tradeEvent';
import logger from '../config/logger';
import { shouldProcessTrade } from './tradeFilter';
import { validateTrade, recordExposure } from './riskManager';

export type TradeDecision = 'COPY' | 'SKIP';

/**
 * The single entry point for the trade decision pipeline.
 *
 * Returns "COPY" only when the trade clears every filter and risk rule.
 * Exposure is recorded inside this function on a COPY decision so the caller
 * cannot forget to update risk state.
 *
 * Order of checks (cheapest first):
 *   1. Trade filter  — size, price, latency (no I/O)
 *   2. Risk manager  — per-trade, total, per-market limits (in-memory)
 */
export function decideTrade(trade: TradeEvent): TradeDecision {
  if (!shouldProcessTrade(trade)) {
    return 'SKIP';
  }

  if (!validateTrade(trade)) {
    return 'SKIP';
  }

  // Record exposure BEFORE returning so concurrent evaluations see the updated
  // totals and cannot both claim the same headroom.
  recordExposure(trade);

  logger.info(
    `[decisionEngine] Accepted: ${trade.side.toUpperCase()} ${trade.size} units` +
    ` @ $${trade.price} on ${trade.market} [id=${trade.id}]`,
  );

  return 'COPY';
}
