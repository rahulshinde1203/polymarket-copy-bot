import { TradeEvent } from '../types/tradeEvent';
import logger from '../config/logger';

export interface Order {
  tradeId: string;
  market: string;
  price: number;
  /** USDC to spend: trade.size scaled by copyPercentage */
  cost: number;
  /** Conditional-token shares to buy/sell: cost / price */
  quantity: number;
  side: 'buy' | 'sell';
}

/**
 * Converts a raw TradeEvent into a ready-to-execute Order.
 *
 * cost     = trade.size × (copyPercentage / 100)   [USDC]
 * quantity = cost / price                            [shares]
 *
 * Returns null if any safety check fails.
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

  const cost = trade.size * (copyPercentage / 100);

  if (cost <= 0 || !isFinite(cost)) {
    logger.warn(
      `[orderBuilder] Rejected: cost=${cost} after applying ` +
      `copyPercentage=${copyPercentage}% to trade.size=${trade.size} [id=${trade.id}]`,
    );
    return null;
  }

  const quantity = cost / trade.price;

  if (quantity <= 0 || !isFinite(quantity)) {
    logger.warn(
      `[orderBuilder] Rejected: quantity=${quantity} (cost=${cost} / price=${trade.price}) [id=${trade.id}]`,
    );
    return null;
  }

  logger.info(
    `[orderBuilder] Order built: ${trade.side.toUpperCase()} ` +
    `quantity=${quantity.toFixed(4)} shares @ $${trade.price} | cost=$${cost.toFixed(4)} USDC` +
    ` | market=${trade.market} (copyPct=${copyPercentage}%)`,
  );

  return {
    tradeId: trade.id,
    market: trade.market,
    price: trade.price,
    cost,
    quantity,
    side: trade.side,
  };
}
