export const BOT_NAME = 'PolymarketBot';
export const VERSION = '1.0.0';

export const LOG_FILE_PATH = 'logs/app.log';

// ── Polymarket endpoints ──────────────────────────────────────────────────────
// Adjust if Polymarket publishes a breaking API change.
export const POLYMARKET_REST_URL = 'https://clob.polymarket.com';

// ── Watcher — polling ─────────────────────────────────────────────────────────
export const POLL_INTERVAL_MS = 5_000;        // REST polling cadence

// ── Watcher — trade validation ────────────────────────────────────────────────
export const TRADE_LATENCY_THRESHOLD_MS = 2_000;  // Reject WS trades older than this
export const MAX_PROCESSED_TRADES = 1_000;         // Prune dedup Set above this size

// ── Decision engine — trade filter ───────────────────────────────────────────
export const MIN_TRADE_SIZE = 5;         // Minimum trade size in USD
export const MAX_TRADE_SIZE = 10_000;    // Maximum trade size in USD
export const MIN_PRICE = 0.01;           // Minimum price (Polymarket 0–1 scale)
export const MAX_PRICE = 0.99;           // Maximum price (Polymarket 0–1 scale)

// ── Decision engine — risk manager ───────────────────────────────────────────
export const MAX_PER_TRADE = 500;        // Max USD size for a single copied trade
export const TOTAL_SPEND_LIMIT = 5_000;  // Max total USD exposure across all markets
export const MAX_PER_MARKET = 1_000;     // Max USD exposure on any single market

// ── Execution engine ──────────────────────────────────────────────────────────
export const DEFAULT_COPY_PERCENTAGE = 100;  // Used when the active trader has no copy_percentage set
