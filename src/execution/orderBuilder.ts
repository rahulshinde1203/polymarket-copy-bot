import { TradeEvent } from '../types/tradeEvent';
import logger from '../config/logger';

export interface Order {
  market: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
}

/**
 * Scales trade.size by copyPercentage and returns a ready-to-execute Order,
 * or null if the resulting order fails any safety check.
 */
export function buildOrder(trade: TradeEvent, copyPercentage: number): Order | null {
  if (!trade.market) {
    logger.warn(`[orderBuilder] Rejected: missing market [id=${trade.id}]`);
    return null;
  }

  if (trade.price <= 0 || !isFinite(trade.price)) {
    logger.warn(`[orderBuilder] Rejected: invalid price=${trade.price} [id=${trade.id}]`);
    return null;
  }

  const size = trade.size * (copyPercentage / 100);

  if (size <= 0 || !isFinite(size)) {
    logger.warn(
      `[orderBuilder] Rejected: size=${size} after applying ` +
      `copyPercentage=${copyPercentage}% to trade.size=${trade.size} [id=${trade.id}]`,
    );
    return null;
  }

  const order: Order = {
    market: trade.market,
    price: trade.price,
    size,
    side: trade.side,
  };

  logger.info(
    `[orderBuilder] Order built: ${order.side.toUpperCase()} ${order.size} units` +
    ` @ $${order.price} on ${order.market} (copyPct=${copyPercentage}%)`,
  );

  return order;
}
