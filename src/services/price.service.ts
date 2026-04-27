import logger from '../config/logger';
import { POLYMARKET_REST_URL } from '../config/constants';

interface MidpointResponse {
  mid?: string;
}

/**
 * Fetches the current mid-price (average of best bid and best ask) for a
 * CLOB token from the Polymarket REST API.
 *
 * The mid-price is the standard reference for slippage calculation because it
 * represents fair market value without being skewed by single-sided pressure.
 *
 * Throws on network failure or an unparseable response — callers must handle
 * this and decide whether to skip or allow the trade.
 */
export async function getCurrentPrice(tokenId: string): Promise<number> {
  const url = `${POLYMARKET_REST_URL}/midpoint?token_id=${encodeURIComponent(tokenId)}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(
      `[priceService] Mid-price fetch failed: HTTP ${res.status} ${res.statusText}` +
      ` for token ${tokenId}`,
    );
  }

  const body = (await res.json()) as MidpointResponse;
  const price = parseFloat(body.mid ?? '');

  if (isNaN(price) || price <= 0) {
    throw new Error(
      `[priceService] Invalid mid-price "${body.mid}" returned for token ${tokenId}`,
    );
  }

  logger.debug(`[priceService] Current mid-price: ${price} for token ${tokenId}`);
  return price;
}
