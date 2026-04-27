import redis from '../infra/cache/redis';
import logger from '../config/logger';
import { TradeEvent, TradeSide } from '../types/tradeEvent';
import { decideTrade } from '../core/decisionEngine';
import { buildOrder } from '../execution/orderBuilder';
import { executeOrder } from '../execution/executor';
import { getActiveTrader } from './trader.service';
import { validateTrade, updateExposure } from '../core/riskManager';
import {
  POLYMARKET_REST_URL,
  POLL_INTERVAL_MS,
  TRADE_LATENCY_THRESHOLD_MS,
  TRADE_DEDUP_TTL_S,
  DEFAULT_COPY_PERCENTAGE,
} from '../config/constants';

// Re-export the shared type so callers that previously imported from here continue to work
export type { TradeEvent, TradeSide };

/**
 * Raw trade shape returned by Polymarket's CLOB REST API.
 * Adjust field names here if Polymarket changes their wire format —
 * no other file needs to change.
 */
interface RawTradeMessage {
  id?: string;
  trade_id?: string;
  maker_address?: string;
  taker_address?: string;
  asset_id?: string;
  market?: string;
  price?: string | number;
  size?: string | number;
  side?: string;
  timestamp?: string | number;
  match_time?: string | number;
}

interface PolymarketRestResponse {
  data?: RawTradeMessage[];
  next_cursor?: string;
}

// ── Redis keys ────────────────────────────────────────────────────────────────

const BOT_RUNNING_KEY = 'bot_running';
const ACTIVE_TRADER_KEY = 'active_trader';

// ── Trade executor ────────────────────────────────────────────────────────────

async function processTrade(trade: TradeEvent): Promise<void> {
  const trader = await getActiveTrader();
  const copyPercentage = trader?.copy_percentage
    ? parseFloat(trader.copy_percentage)
    : DEFAULT_COPY_PERCENTAGE;

  const order = buildOrder(trade, copyPercentage);
  if (!order) return;

  if (!await validateTrade(trade, order.cost)) return;

  try {
    await executeOrder(order);
    await updateExposure(order.cost, trade.market);
  } catch {
    // executeOrder already logged the full failure chain — exposure is NOT
    // updated because the order was never placed successfully.
  }
}

// ── WatcherService ────────────────────────────────────────────────────────────

class WatcherService {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  // ── Public API ──────────────────────────────────────────────────────────────

  start(): void {
    this.stopped = false;
    logger.info('[watcher] Starting trade watcher (REST polling mode)');
    this.startPolling();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopPolling();
    logger.info('[watcher] Watcher stopped');
  }

  // ── Polling ─────────────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer) return;
    logger.info(`[watcher] Polling started (every ${POLL_INTERVAL_MS}ms)`);
    void this.pollTrades(); // immediate first tick
    this.pollTimer = setInterval(() => void this.pollTrades(), POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ── Redis deduplication ─────────────────────────────────────────────────────
  // Trade IDs are stored in Redis with a TTL so restarts never replay old trades.
  // On Redis failure we treat the trade as a duplicate (safe default — better to
  // miss one trade than to double-execute).

  private async isDuplicate(id: string): Promise<boolean> {
    try {
      const existing = await redis.get(`trade:${id}`);
      return existing !== null;
    } catch (err) {
      logger.warn(
        `[poll] Redis dedup check failed for trade ${id} — skipping as precaution`,
        err instanceof Error ? err : new Error(String(err)),
      );
      return true;
    }
  }

  private async markProcessed(id: string): Promise<void> {
    try {
      await redis.set(`trade:${id}`, '1', 'EX', TRADE_DEDUP_TTL_S);
    } catch (err) {
      logger.warn(
        `[poll] Redis dedup write failed for trade ${id}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  // ── Trade parsing ───────────────────────────────────────────────────────────

  private parseTradeMessage(msg: RawTradeMessage): TradeEvent | null {
    const wallet = msg.maker_address ?? msg.taker_address;
    const market = msg.asset_id ?? msg.market;
    const rawPrice = msg.price;
    const rawSize = msg.size;
    const rawSide = (msg.side ?? '').toLowerCase();
    const rawTs = msg.timestamp ?? msg.match_time;

    if (!wallet || !market || rawPrice === undefined || rawSize === undefined) {
      logger.debug('[watcher] Invalid trade — missing required fields (wallet/market/price/size)');
      return null;
    }

    const price = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice);
    const size = typeof rawSize === 'number' ? rawSize : parseFloat(rawSize);

    if (isNaN(price) || isNaN(size) || price <= 0 || size <= 0) {
      logger.warn(`[watcher] Invalid trade — bad numeric values: price=${rawPrice} size=${rawSize}`);
      return null;
    }

    const side: TradeSide = rawSide === 'sell' ? 'sell' : 'buy';
    const timestamp =
      rawTs !== undefined
        ? typeof rawTs === 'number' ? rawTs : parseInt(rawTs, 10)
        : Date.now();

    // Use API-provided ID when available; fall back to a deterministic composite key
    const id =
      msg.id ??
      msg.trade_id ??
      `${wallet}-${market}-${timestamp}-${price}-${size}`;

    return { id, wallet, market, price, size, side, timestamp, source: 'rest' };
  }

  // ── Last-trade cursor helpers ────────────────────────────────────────────────

  private lastTradeKey(traderAddress: string): string {
    return `last_trade_id:${traderAddress}`;
  }

  // ── Poll loop ───────────────────────────────────────────────────────────────

  private async pollTrades(): Promise<void> {
    if (this.stopped) return;

    try {
      // Gate: bot running?
      const running = await redis.get(BOT_RUNNING_KEY);
      if (running !== 'true') {
        logger.debug('[poll] Bot stopped — skipping poll tick');
        return;
      }

      // Gate: active trader set?
      const activeAddress = await redis.get(ACTIVE_TRADER_KEY);
      if (!activeAddress) {
        logger.debug('[poll] No active trader — skipping poll tick');
        return;
      }

      const url = `${POLYMARKET_REST_URL}/trades?maker=${activeAddress}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const body = (await res.json()) as PolymarketRestResponse | RawTradeMessage[];
      const items: RawTradeMessage[] = Array.isArray(body) ? body : (body.data ?? []);

      if (items.length === 0) return;

      logger.debug(`[poll] Fetched ${items.length} trade(s) for ${activeAddress}`);

      // ── Cursor: load last processed trade ID ──────────────────────────────
      // API returns trades newest-first. The cursor tells us where we stopped
      // last time so we can skip already-processed trades across restarts.

      const lastTradeId = await redis.get(this.lastTradeKey(activeAddress));
      if (lastTradeId) {
        logger.debug(`[poll] Last trade ID loaded: ${lastTradeId}`);
      }

      // Determine which raw items are new
      let toProcess: RawTradeMessage[];

      if (!lastTradeId) {
        // First run — process only the single newest trade to avoid replaying
        // the trader's entire history (which could be thousands of old trades).
        toProcess = [items[0]];
        logger.debug('[poll] No last trade ID — processing latest trade only to avoid backlog');
      } else {
        // Oldest → newest so we process in chronological order.
        // Stop as soon as we hit the ID we processed last time.
        logger.debug('[poll] Processing new trades only');
        toProcess = [];
        for (const item of [...items].reverse()) {
          const itemId = item.id ?? item.trade_id;
          if (itemId === lastTradeId) break;
          toProcess.push(item);
        }
      }

      // ── Evaluate each new trade through the existing pipeline ─────────────

      for (const item of toProcess) {
        const trade = this.parseTradeMessage(item);
        if (!trade) continue;

        logger.debug(
          `[poll] Trade detected: id=${trade.id} ${trade.side} ` +
          `${trade.size} @ ${trade.price} wallet=${trade.wallet}`,
        );

        // Duplicate check (Redis TTL key)
        if (await this.isDuplicate(trade.id)) {
          logger.debug(`[poll] Duplicate trade skipped: ${trade.id}`);
          continue;
        }

        // Wallet match (normalised)
        if (trade.wallet.toLowerCase() !== activeAddress.toLowerCase()) {
          logger.debug(
            `[poll] Wallet mismatch — trade ${trade.id}: ` +
            `wallet=${trade.wallet} activeTrader=${activeAddress}`,
          );
          continue;
        }

        // Stale check
        const ageMs = Date.now() - trade.timestamp;
        if (ageMs > TRADE_LATENCY_THRESHOLD_MS) {
          logger.debug(
            `[poll] Stale trade skipped: id=${trade.id} age=${ageMs}ms` +
            ` (threshold=${TRADE_LATENCY_THRESHOLD_MS}ms)`,
          );
          continue;
        }

        logger.info(
          `[poll] ✓ MATCHED: ${trade.side.toUpperCase()} ${trade.size} units` +
          ` @ $${trade.price} on ${trade.market} [id=${trade.id}]`,
        );

        // Mark in Redis before evaluating — prevents re-processing if the decision throws
        logger.debug(`[poll] New trade accepted: ${trade.id}`);
        await this.markProcessed(trade.id);

        const decision = decideTrade(trade);
        logger.debug(`[poll] Decision for ${trade.id}: ${decision}`);

        if (decision === 'COPY') {
          await processTrade(trade);
        }
      }

      // ── Cursor: advance to the newest trade returned by the API ──────────
      // items[0] is always the most recent trade (API is newest-first).
      // Storing it here means the next poll — or the next restart — skips
      // everything up to and including this trade.

      const newestId = items[0].id ?? items[0].trade_id;
      if (newestId) {
        await redis.set(this.lastTradeKey(activeAddress), newestId);
        logger.debug(`[poll] Last trade ID updated: ${newestId}`);
      }
    } catch (err) {
      logger.error(
        '[poll] REST poll failed',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}

// ── Singleton exports ─────────────────────────────────────────────────────────

const watcher = new WatcherService();

export function startWatcher(): void {
  watcher.start();
}

export async function stopWatcher(): Promise<void> {
  await watcher.stop();
}
