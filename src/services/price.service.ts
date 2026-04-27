import logger from '../config/logger';
import { POLYMARKET_REST_URL } from '../config/constants';

interface OrderbookLevel {
  price: string;
  size: string;
}

interface OrderbookResponse {
  bids?: OrderbookLevel[];
  asks?: OrderbookLevel[];
}

export interface OrderbookPrice {
  price: number;    // bestAsk for buy orders, bestBid for sell orders
  bestBid: number;
  bestAsk: number;
  spread: number;   // (bestAsk - bestBid) / bestAsk
}

/**
 * Fetches the live orderbook for a CLOB token and returns the relevant
 * execution price plus spread metrics.
 *
 * Price selection:
 *   buy  → bestAsk (lowest available sell price — what the buyer pays)
 *   sell → bestBid (highest available buy price — what the seller receives)
 *
 * Throws on:
 *   - HTTP error (including 429 rate limit)
 *   - Empty orderbook (no bids or no asks)
 *   - Unparseable price fields
 *
 * Callers must catch and decide whether to skip or allow the trade.
 */
export async function getCurrentPrice(tokenId: string, side: 'buy' | 'sell'): Promise<OrderbookPrice> {
  const url = `${POLYMARKET_REST_URL}/book?token_id=${encodeURIComponent(tokenId)}`;

  const res = await fetch(url);

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(
        `[priceService] Rate limited (429) fetching orderbook for token ${tokenId}`,
      );
    }
    throw new Error(
      `[priceService] Orderbook fetch failed: HTTP ${res.status} ${res.statusText}` +
      ` for token ${tokenId}`,
    );
  }

  const body = (await res.json()) as OrderbookResponse;
  const bids = body.bids ?? [];
  const asks = body.asks ?? [];

  if (bids.length === 0 || asks.length === 0) {
    throw new Error(
      `[priceService] Empty orderbook for token ${tokenId}` +
      ` — bids=${bids.length} asks=${asks.length}`,
    );
  }

  // Polymarket returns bids sorted descending (highest first) and asks ascending (lowest first)
  const bestBid = parseFloat(bids[0].price);
  const bestAsk = parseFloat(asks[0].price);

  if (isNaN(bestBid) || isNaN(bestAsk) || bestBid <= 0 || bestAsk <= 0) {
    throw new Error(
      `[priceService] Invalid orderbook prices: bestBid=${bids[0].price}` +
      ` bestAsk=${asks[0].price} for token ${tokenId}`,
    );
  }

  const spread = (bestAsk - bestBid) / bestAsk;
  const price = side === 'buy' ? bestAsk : bestBid;

  logger.debug(
    `[priceService] Orderbook: bestBid=${bestBid} bestAsk=${bestAsk}` +
    ` spread=${(spread * 100).toFixed(2)}% → price=${price} (side=${side})` +
    ` token=${tokenId}`,
  );

  return { price, bestBid, bestAsk, spread };
}
