import { TradeEvent } from '../types/tradeEvent';
import logger from '../config/logger';
import { POLYMARKET_REST_URL, MAX_SLIPPAGE } from '../config/constants';

// ── Market token mapping ──────────────────────────────────────────────────────
// In Polymarket the asset_id (condition token address) that arrives in trade
// events IS the CLOB tokenID.  Add entries here only when a market needs an
// explicit override (e.g. neg-risk markets that use a different token).

const TOKEN_MAP: Record<string, string> = {
  // '<condition-id>': '<clob-token-id>',
};

/**
 * Resolves a raw market ID (asset_id / condition ID from a trade event) to
 * the CLOB tokenID used when building and submitting orders.
 *
 * Falls back to the market value itself when no override is registered —
 * which is correct for the vast majority of Polymarket markets.
 */
export function getMarketToken(market: string): string {
  const override = TOKEN_MAP[market];
  if (override) {
    logger.debug(`[marketService] Token override: ${market} → ${override}`);
    return override;
  }
  logger.debug(`[marketService] No token override for market ${market} — using asset ID as token ID`);
  return market;
}

// ── Slippage check ────────────────────────────────────────────────────────────

interface MidpointResponse {
  mid?: string;
}

/**
 * Compares the copied trade's price against the current CLOB mid-price.
 * Returns false (skip trade) when slippage exceeds MAX_SLIPPAGE.
 * Fails open (returns true) on any network or parse error so a temporary
 * CLOB outage does not halt all copying.
 */
export async function checkSlippage(trade: TradeEvent, tokenId: string): Promise<boolean> {
  try {
    const url = `${POLYMARKET_REST_URL}/midpoint?token_id=${encodeURIComponent(tokenId)}`;
    const res = await fetch(url);

    if (!res.ok) {
      logger.warn(
        `[marketService] Mid-price fetch failed (HTTP ${res.status}) — skipping slippage check [id=${trade.id}]`,
      );
      return true; // fail-open
    }

    const body = (await res.json()) as MidpointResponse;
    const midPrice = parseFloat(body.mid ?? '');

    if (isNaN(midPrice) || midPrice <= 0) {
      logger.warn(
        `[marketService] Invalid mid-price in response — skipping slippage check [id=${trade.id}]`,
      );
      return true; // fail-open
    }

    const slippage = Math.abs(midPrice - trade.price) / trade.price;
    const slippagePct = (slippage * 100).toFixed(2);

    logger.info(
      `[marketService] Slippage check: trade.price=${trade.price} mid=${midPrice} ` +
      `slippage=${slippagePct}% limit=${(MAX_SLIPPAGE * 100).toFixed(0)}% [id=${trade.id}]`,
    );

    if (slippage > MAX_SLIPPAGE) {
      logger.warn(
        `[marketService] Slippage exceeded: ${slippagePct}% > ${(MAX_SLIPPAGE * 100).toFixed(0)}%` +
        ` — skipping trade ${trade.id}`,
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.warn(
      `[marketService] Slippage check error — proceeding (fail-open) [id=${trade.id}]`,
      err instanceof Error ? err : new Error(String(err)),
    );
    return true; // fail-open
  }
}
