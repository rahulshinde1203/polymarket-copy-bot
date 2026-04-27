import redis from '../infra/cache/redis';
import logger from '../config/logger';
import { POLYMARKET_REST_URL } from '../config/constants';

// ── Redis cache ───────────────────────────────────────────────────────────────

const CACHE_TTL_S = 3_600; // 1 hour

function cacheKey(market: string): string {
  return `market_token:${market}`;
}

// ── Polymarket API types ──────────────────────────────────────────────────────

interface PolyToken {
  token_id: string;
  outcome: string;
  price?: number;
}

interface MarketPayload {
  condition_id?: string;
  tokens?: PolyToken[];
}

// The /markets endpoint returns either a single object or a paginated wrapper.
type MarketsApiResponse = MarketPayload | { data?: MarketPayload[] };

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractTokenId(body: MarketsApiResponse): string | null {
  // Single-market response: { tokens: [...] }
  if ('tokens' in body && Array.isArray(body.tokens)) {
    return body.tokens[0]?.token_id ?? null;
  }
  // Paginated response: { data: [{ tokens: [...] }] }
  if ('data' in body && Array.isArray(body.data)) {
    return body.data[0]?.tokens?.[0]?.token_id ?? null;
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolves a raw market identifier to a Polymarket CLOB token ID.
 *
 * Resolution order:
 *   1. Redis cache  — key: market_token:<market>  TTL: 1 hour
 *   2. REST API     — GET /markets/<market> then GET /markets?condition_id=<market>
 *   3. Direct use   — asset_id from trade events already IS the CLOB token ID;
 *                     used as fallback when neither API variant finds a mapping.
 *
 * Returns null only on a genuine network failure, signalling the caller to skip
 * the trade rather than place it with an unresolved token.
 *
 * Logs:
 *   debug  — cache hit / direct passthrough
 *   info   — successfully resolved via API
 *   error  — network failure; trade will be skipped
 */
export async function getTokenId(market: string): Promise<string | null> {
  // ── 1. Redis cache ──────────────────────────────────────────────────────────
  try {
    const cached = await redis.get(cacheKey(market));
    if (cached) {
      logger.debug(`[marketService] Cache hit: ${market} → ${cached}`);
      return cached;
    }
  } catch (err) {
    logger.warn(
      '[marketService] Redis cache read failed — continuing without cache',
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  // ── 2. Polymarket REST API ──────────────────────────────────────────────────
  // Try the single-market endpoint first (most efficient); fall back to the
  // list endpoint in case the host expects condition_id as a query parameter.

  try {
    let tokenId: string | null = null;

    for (const url of [
      `${POLYMARKET_REST_URL}/markets/${encodeURIComponent(market)}`,
      `${POLYMARKET_REST_URL}/markets?condition_id=${encodeURIComponent(market)}`,
    ]) {
      const res = await fetch(url);
      if (!res.ok) continue;

      const body = (await res.json()) as MarketsApiResponse;
      tokenId = extractTokenId(body);
      if (tokenId) break;
    }

    if (tokenId) {
      logger.info(`[marketService] Resolved via API: ${market} → ${tokenId}`);
      await redis.set(cacheKey(market), tokenId, 'EX', CACHE_TTL_S).catch(() => {/* best-effort */});
      return tokenId;
    }

    // ── 3. Passthrough — asset_id IS the token ID ───────────────────────────
    // The API returned 2xx but no token entry — the market identifier that
    // arrived in the trade event is most likely already an asset_id / token ID.
    logger.debug(
      `[marketService] No mapping found for market ${market} — ` +
      `treating asset_id as token ID directly`,
    );
    await redis.set(cacheKey(market), market, 'EX', CACHE_TTL_S).catch(() => {/* best-effort */});
    return market;

  } catch (err) {
    logger.error(
      `[marketService] Network error resolving token for market ${market} — skipping trade`,
      err instanceof Error ? err : new Error(String(err)),
    );
    return null;
  }
}
