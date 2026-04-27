import { TradeEvent } from '../types/tradeEvent';
import logger from '../config/logger';
import { shouldProcessTrade } from './tradeFilter';

export type TradeDecision = 'COPY' | 'SKIP';

/**
 * Fast pre-filter for the trade pipeline.
 *
 * Checks only criteria that do not require knowing the scaled order size
 * (size bounds, price bounds, source-specific latency).  Full risk validation
 * — per-trade cap, total and per-market exposure — runs in processTrade()
 * after buildOrder() computes the actual order size.
 */
export function decideTrade(trade: TradeEvent): TradeDecision {
  if (!shouldProcessTrade(trade)) {
    return 'SKIP';
  }

  logger.info(
    `[decisionEngine] Passed filter: ${trade.side.toUpperCase()} ${trade.size} units` +
    ` @ $${trade.price} on ${trade.market} [id=${trade.id}]`,
  );

  return 'COPY';
}
