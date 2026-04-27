import { TradeEvent } from '../types/tradeEvent';
import logger from '../config/logger';
import {
  MIN_TRADE_SIZE,
  MAX_TRADE_SIZE,
  MIN_PRICE,
  MAX_PRICE,
  TRADE_LATENCY_THRESHOLD_MS,
} from '../config/constants';

/**
 * Determines whether a trade passes basic eligibility criteria.
 *
 * The latency gate applies only to WebSocket trades (`source === 'ws'`).
 * REST-polled trades are inherently older than the 2 s threshold — they are
 * stamped with the Polymarket execution time, not the polling time — so
 * filtering them by age would silently discard all REST fallback data.
 */
export function shouldProcessTrade(trade: TradeEvent): boolean {
  if (trade.size < MIN_TRADE_SIZE) {
    logger.debug(
      `[tradeFilter] Skipped: size too small — ${trade.size} < ${MIN_TRADE_SIZE} [id=${trade.id}]`,
    );
    return false;
  }

  if (trade.size > MAX_TRADE_SIZE) {
    logger.debug(
      `[tradeFilter] Skipped: size too large — ${trade.size} > ${MAX_TRADE_SIZE} [id=${trade.id}]`,
    );
    return false;
  }

  if (trade.price < MIN_PRICE) {
    logger.debug(
      `[tradeFilter] Skipped: price too low — ${trade.price} < ${MIN_PRICE} [id=${trade.id}]`,
    );
    return false;
  }

  if (trade.price > MAX_PRICE) {
    logger.debug(
      `[tradeFilter] Skipped: price too high — ${trade.price} > ${MAX_PRICE} [id=${trade.id}]`,
    );
    return false;
  }

  if (trade.source === 'ws') {
    const ageMs = Date.now() - trade.timestamp;
    if (ageMs > TRADE_LATENCY_THRESHOLD_MS) {
      logger.debug(
        `[tradeFilter] Skipped: stale WebSocket trade — age=${ageMs}ms` +
        ` > threshold=${TRADE_LATENCY_THRESHOLD_MS}ms [id=${trade.id}]`,
      );
      return false;
    }
  }

  return true;
}
