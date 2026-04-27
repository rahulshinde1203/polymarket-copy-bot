export const BOT_NAME = 'PolymarketBot';
export const VERSION = '1.0.0';

export const LOG_FILE_PATH = 'logs/app.log';

// ── Polymarket endpoints ──────────────────────────────────────────────────────
// Adjust if Polymarket publishes a breaking API change.
export const POLYMARKET_REST_URL = 'https://clob.polymarket.com';

// ── Watcher — polling ─────────────────────────────────────────────────────────
export const POLL_INTERVAL_MS = 5_000;        // REST polling cadence

// ── Watcher — trade validation ────────────────────────────────────────────────
export const TRADE_LATENCY_THRESHOLD_MS = 2_000;  // Reject trades older than this
export const TRADE_DEDUP_TTL_S = 60;               // Redis TTL for processed trade IDs (seconds)

// ── Decision engine — trade filter ───────────────────────────────────────────
export const MIN_TRADE_SIZE = 5;         // Minimum trade size in USD
export const MAX_TRADE_SIZE = 10_000;    // Maximum trade size in USD
export const MIN_PRICE = 0.01;           // Minimum price (Polymarket 0–1 scale)
export const MAX_PRICE = 0.99;           // Maximum price (Polymarket 0–1 scale)

// ── Risk manager ─────────────────────────────────────────────────────────────
export const MAX_PER_TRADE = 100;           // Max USD size for a single copied order
export const MAX_TOTAL_EXPOSURE = 500;      // Max total USD exposure across all markets
export const MAX_PER_MARKET = 200;          // Max USD exposure on any single market

// ── Execution engine ──────────────────────────────────────────────────────────
export const DEFAULT_COPY_PERCENTAGE = 100;   // Used when the active trader has no copy_percentage set
export const PAPER_SIMULATED_BALANCE = 10_000;  // Simulated wallet balance returned in paper mode
export const MIN_REQUIRED_BALANCE = 10;         // Buffer kept in wallet above order.size (live mode)
export const EXECUTION_DEDUP_TTL_S = 3_600;    // Redis TTL for executed order IDs (1 hour)

// ── Slippage protection ───────────────────────────────────────────────────────
// Slippage is computed as abs(orderbook_price - trade.price) / trade.price.
// In liquid markets (spread ≤ SPREAD_LIQUIDITY_THRESHOLD) the tolerance is
// DEFAULT_MAX_SLIPPAGE; in illiquid markets it tightens to LOW_LIQUIDITY_SLIPPAGE.
export const DEFAULT_MAX_SLIPPAGE = 0.03;          // 3% — normal market conditions
export const LOW_LIQUIDITY_SLIPPAGE = 0.02;        // 2% — wide-spread / illiquid markets
export const SPREAD_LIQUIDITY_THRESHOLD = 0.05;    // spread > 5% → low-liquidity path

// ── Live execution — Polymarket CLOB ─────────────────────────────────────────
export const POLYGON_CHAIN_ID = 137;
// Native USDC on Polygon (6 decimals)
export const USDC_ADDRESS_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
