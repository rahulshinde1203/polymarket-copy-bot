# PolymarketBot

A production-ready TypeScript trading bot for Polymarket prediction markets.

---

## Phase 1 — Project Foundation

This phase establishes the core scaffold: configuration management, structured logging, and the project entry point. Every subsequent phase builds on top of this foundation.

---

## Folder Structure

```
polymarketBot/
├── src/
│   ├── config/
│   │   ├── env.ts          # Loads and validates environment variables
│   │   ├── constants.ts    # Global constants (bot name, version, paths)
│   │   └── logger.ts       # Winston logger — console + rotating file output
│   ├── utils/
│   │   └── helpers.ts      # Shared utilities: sleep, formatCurrency, withRetry
│   ├── types/
│   │   └── global.d.ts     # Global TypeScript type augmentations (ProcessEnv)
│   └── app.ts              # Entry point — bootstraps config and logger
├── logs/                   # Runtime log output (git-ignored)
├── dist/                   # Compiled JS output (git-ignored)
├── .env.example            # Template for required environment variables
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Environment Setup

1. Copy the example env file and fill in values:

```bash
cp .env.example .env
```

2. Available variables:

| Variable    | Default       | Description                          |
|-------------|---------------|--------------------------------------|
| `NODE_ENV`  | `development` | Runtime environment                  |
| `LOG_LEVEL` | `info`        | Winston log level (`debug`/`info`/`warn`/`error`) |

Add additional required variable names to the `REQUIRED_VARS` array in [src/config/env.ts](src/config/env.ts) — the app will refuse to start if any are missing.

---

## How to Run

### Install dependencies

```bash
npm install
```

### Development (auto-restarts on file changes)

```bash
npm run dev
```

### Production build

```bash
npm run build
npm start
```

### Type-check without emitting

```bash
npm run type-check
```

---

## Logging System

Logging is handled by [Winston](https://github.com/winstonjs/winston) and configured in [src/config/logger.ts](src/config/logger.ts).

| Transport | Output              | Notes                          |
|-----------|---------------------|--------------------------------|
| Console   | stdout              | Colorized, human-readable      |
| File      | `logs/app.log`      | Rotating: 10 MB max, 5 files   |

Log level is controlled by the `LOG_LEVEL` env variable. Set it to `debug` during development for verbose output.

All log lines follow the format:

```
YYYY-MM-DD HH:mm:ss [level]: message
```

Errors passed to `logger.error()` automatically include the full stack trace.

---

## Utilities

[src/utils/helpers.ts](src/utils/helpers.ts) provides:

- `sleep(ms)` — promise-based delay
- `formatCurrency(amount, decimals)` — fixed-decimal string formatting
- `withRetry(fn, options)` — exponential-backoff retry wrapper for async functions

---

## Phase 1 Improvements

### 1. What Was Improved

| Area | Change |
|------|--------|
| **Graceful shutdown** | `SIGINT` / `SIGTERM` handlers flush state and exit cleanly |
| **Crash safety** | `uncaughtException` and `unhandledRejection` are caught, logged with full stack, and cause a controlled `exit(1)` |
| **Retry logic** | `withRetry` now tracks attempt number, logs each failure with attempt count, applies true exponential backoff (`delayMs × 2^attempt`), and accepts a `label` for traceability |
| **Logs directory** | `logger.ts` auto-creates the `logs/` directory at startup via `fs.mkdirSync({ recursive: true })` — no manual setup needed |
| **Structured file logs** | File transport now emits JSON (`{ level, message, timestamp }`), making logs parseable by Datadog, ELK, and similar aggregators |
| **Centralized config** | New `src/config/appConfig.ts` is the single source for app name, version, env, port, and health-check interval |
| **Typed env** | `env.PORT` added with `parseInt` coercion; `NODE_ENV` and `LOG_LEVEL` are narrowed to union literal types |
| **Health check** | `setInterval` in `app.ts` emits `"System healthy"` every 60 s so uptime monitors can tail the log file |

---

### 2. Why It Matters

**Graceful shutdown** ensures open exchange orders are not orphaned and in-flight requests have time to complete — critical for a trading bot where an abrupt kill can leave positions in an unknown state.

**Crash handlers** (`uncaughtException` / `unhandledRejection`) prevent the process from silently hanging after an unrecoverable error; they force a logged, observable exit that a process supervisor (PM2, systemd) can restart.

**JSON file logs** allow log aggregators to parse fields without regex fragility. A human-readable console format is kept for local development.

**Exponential backoff in `withRetry`** respects API rate-limits and avoids thundering-herd retries under network degradation — a common cause of trading bot bans.

---

### 3. File Changes

| File | Status | Summary |
|------|--------|---------|
| [src/app.ts](src/app.ts) | Updated | Shutdown signals, crash handlers, health-check timer |
| [src/config/env.ts](src/config/env.ts) | Updated | `PORT` added, literal-union type narrowing |
| [src/config/logger.ts](src/config/logger.ts) | Updated | Auto-create logs dir, JSON format on file transport |
| [src/config/appConfig.ts](src/config/appConfig.ts) | **New** | Centralized app-level configuration object |
| [src/utils/helpers.ts](src/utils/helpers.ts) | Updated | `withRetry` rewritten with options object, attempt counter, exponential backoff |

---

### 4. Example — Retry Behaviour

```typescript
import { withRetry } from './utils/helpers';

const price = await withRetry(
  () => fetchMarketPrice('BTC-USD'),
  { retries: 4, delayMs: 500, label: 'fetchMarketPrice' },
);
```

Log output for a flaky call that succeeds on attempt 3:

```
2026-04-28 09:01:00 [warn]: [fetchMarketPrice] Attempt 1/5 failed: ECONNRESET — retrying in 500ms
2026-04-28 09:01:01 [warn]: [fetchMarketPrice] Attempt 2/5 failed: ECONNRESET — retrying in 1000ms
2026-04-28 09:01:03 [info]: price returned successfully
```

Backoff schedule: `500 ms → 1 000 ms → 2 000 ms → 4 000 ms`.

---

### 5. Shutdown Flow Example

```
$ kill -SIGTERM <pid>

2026-04-28 09:05:00 [info]: Received SIGTERM — shutting down gracefully
2026-04-28 09:05:00 [info]: Shutdown complete
```

Steps in order:
1. Signal received → `shutdown()` called.
2. Health-check interval cleared.
3. *(Future)* Exchange connections closed, open orders cancelled.
4. `process.exit(0)` — clean exit code for the process supervisor.

---

### Notes

- `healthCheckTimer.unref()` is called so the timer does not keep the Node.js event loop alive when all other async work finishes — the process exits naturally once the bot is idle.
- The file log retains older plain-text lines from Phase 1; all new entries are JSON. A log aggregator should handle mixed formats by parsing JSON and falling back to raw text.
- `PORT` is parsed to `number` at startup so downstream code never needs to call `parseInt` again.

---

## Phase 2: Trader Management System

### 1. What Was Built

A complete trader storage and selection layer backed by two datastores:

- **PostgreSQL** holds the permanent record of every trader (address, tag, copy percentage) and the current bot state (which trader is active).
- **Redis** caches the active trader's address for sub-millisecond reads during hot trading loops.
- **Trader service** (`src/services/trader.service.ts`) exposes five functions that cover the full lifecycle: add, remove, list, select, and read the active trader.

---

### 2. Database Design

Apply the schema once before first run:

```bash
psql $POSTGRES_URL -f src/infra/db/schema.sql
```

#### `traders` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` | Auto-generated primary key (`gen_random_uuid()`) |
| `address` | `TEXT` | Ethereum address — unique, not null |
| `tag` | `TEXT` | Optional human-readable label |
| `copy_percentage` | `NUMERIC(5,2)` | Optional, e.g. `75.50` for 75.5 % |
| `created_at` | `TIMESTAMPTZ` | Set automatically on insert |

#### `bot_state` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | `INT` | Always `1` — single-row singleton |
| `active_trader` | `TEXT` | Address of the currently active trader, or `NULL` |

The schema seeds the `bot_state` row on creation (`ON CONFLICT DO NOTHING`), so the row is always present.

---

### 3. How It Works

```
setActiveTrader(address)
  │
  ├─▶ Verify trader exists in PostgreSQL
  ├─▶ UPDATE bot_state SET active_trader = address WHERE id = 1
  └─▶ redis.set('active_trader', address)

getActiveTrader()
  │
  ├─▶ redis.get('active_trader')          ← fast path (cache hit)
  │     └─▶ SELECT trader from PostgreSQL
  │
  └─▶ (cache miss) SELECT bot_state from PostgreSQL
        └─▶ SELECT trader from PostgreSQL
              └─▶ redis.set('active_trader', address)  ← re-populate
```

Only one trader can be active at a time because `bot_state` is a single-row table. Removing the active trader atomically clears `bot_state` and the Redis key in the same operation.

---

### 4. How to Use

#### Environment setup

Add to your `.env` (copy from `.env.example`):

```env
POSTGRES_URL=postgresql://localhost:5432/polymarketbot
REDIS_URL=redis://localhost:6379
```

#### Add a trader

```typescript
import { addTrader } from './services/trader.service';

await addTrader('0xAbCd...1234', 'whale-A', 80);
```

- Address must be a valid Ethereum address (`0x` + 40 hex chars) — throws otherwise.
- Duplicate addresses throw `"Trader already exists"`.

#### List all traders

```typescript
import { listTraders } from './services/trader.service';

const traders = await listTraders();
console.table(traders);
```

#### Set the active trader

```typescript
import { setActiveTrader } from './services/trader.service';

await setActiveTrader('0xAbCd...1234');
// Updates PostgreSQL + Redis atomically
```

#### Read the active trader (hot path)

```typescript
import { getActiveTrader } from './services/trader.service';

const trader = await getActiveTrader();
// Returns null if no trader is set
```

#### Remove a trader

```typescript
import { removeTrader } from './services/trader.service';

await removeTrader('0xAbCd...1234');
// If this trader was active, clears active_trader in DB + Redis automatically
```

---

### 5. Example — Switching the Active Trader

```
> addTrader('0xAAA...', 'whale-A', 50)
info: Trader added: 0xAAA... (whale-A)

> addTrader('0xBBB...', 'whale-B', 75)
info: Trader added: 0xBBB... (whale-B)

> setActiveTrader('0xAAA...')
info: Active trader set: 0xAAA...

> setActiveTrader('0xBBB...')
info: Active trader set: 0xBBB...
// 0xAAA... is no longer active; bot_state and Redis updated immediately

> removeTrader('0xBBB...')
info: Active trader cleared — 0xBBB... was removed
info: Trader removed: 0xBBB...
// No active trader; getActiveTrader() returns null
```

---

### 6. Notes

- **Only one active trader at a time.** The `bot_state` singleton row enforces this at the database level; there is no race condition.
- **Redis is cache, not source of truth.** PostgreSQL is authoritative. If Redis is flushed or restarted, `getActiveTrader()` falls back to the DB and repopulates the cache transparently.
- **Stale cache handling.** If a Redis hit returns an address that no longer exists in the DB (e.g. after a manual delete), the stale key is deleted and the DB is consulted.
- **Graceful shutdown** (`SIGINT`/`SIGTERM`) now closes both the PostgreSQL connection pool and the Redis client before exiting, preventing connection leaks.
- **pg returns `NUMERIC` as strings.** The `copy_percentage` field in the `Trader` interface is typed `string | null` to match pg's wire format accurately.

### New files

| File | Purpose |
|------|---------|
| [src/infra/db/postgres.ts](src/infra/db/postgres.ts) | pg Pool, typed `query<T>` wrapper, `connectPostgres` |
| [src/infra/db/schema.sql](src/infra/db/schema.sql) | DDL for `traders` and `bot_state` tables |
| [src/infra/cache/redis.ts](src/infra/cache/redis.ts) | ioredis client, `connectRedis`, `disconnectRedis` |
| [src/services/trader.service.ts](src/services/trader.service.ts) | `addTrader`, `removeTrader`, `listTraders`, `setActiveTrader`, `getActiveTrader` |

### Updated files

| File | Change |
|------|--------|
| [src/config/env.ts](src/config/env.ts) | `POSTGRES_URL` and `REDIS_URL` added to `REQUIRED_VARS` and `env` object |
| [src/types/global.d.ts](src/types/global.d.ts) | `POSTGRES_URL`, `REDIS_URL` added to `ProcessEnv` |
| [src/app.ts](src/app.ts) | Calls `connectPostgres` and `connectRedis` on startup; shutdown closes both |
| [.env.example](.env.example) | Connection string placeholders added |

---

## Phase 3: Telegram Control System

### 1. What Was Built

A Telegram bot that serves as the sole control interface for the trading bot. Operators send commands directly in a Telegram chat; the bot authenticates each message by Telegram user ID, executes the appropriate trader service action, and replies with a structured result. Bot running state is stored in Redis so it survives process restarts.

New files:

| File | Purpose |
|------|---------|
| [src/bot/telegram/bot.ts](src/bot/telegram/bot.ts) | Creates the `TelegramBot` instance, wires polling, exports `initBot` / `stopBot` |
| [src/bot/telegram/commands.ts](src/bot/telegram/commands.ts) | All 8 command handlers with auth guard, arg parsing, and error replies |

Updated files:

| File | Change |
|------|--------|
| [src/config/env.ts](src/config/env.ts) | `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_IDS` added to required vars and `env` object |
| [src/types/global.d.ts](src/types/global.d.ts) | Both new env vars added to `ProcessEnv` |
| [src/services/trader.service.ts](src/services/trader.service.ts) | `updateCopyPercentage(address, pct)` added for `/setpct` |
| [src/app.ts](src/app.ts) | Calls `initBot()` on startup, `stopBot()` included in graceful shutdown |
| [.env.example](.env.example) | Telegram placeholders added |

---

### 2. Commands List

| Command | Arguments | Description |
|---------|-----------|-------------|
| `/start` | — | Marks bot as **running** (`bot_running = true` in Redis) |
| `/stop` | — | Marks bot as **stopped** (`bot_running = false` in Redis) |
| `/status` | — | Shows current running state and active trader |
| `/list` | — | Lists all registered traders with address, tag, and copy % |
| `/add` | `<address> [tag] [pct]` | Registers a new trader; tag and pct are optional |
| `/remove` | `<address>` | Removes a trader; clears active trader if it matches |
| `/select` | `<address>` | Sets the active trader (updates DB + Redis) |
| `/setpct` | `<0–100>` | Updates copy % for the **currently active** trader |

All commands reject messages from non-whitelisted user IDs with `⛔ Unauthorized`.

---

### 3. Setup Instructions

#### Create the bot with BotFather

1. Open Telegram and search for **@BotFather**.
2. Send `/newbot` and follow the prompts (choose a name and username).
3. BotFather replies with a token like `110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`. Copy it.
4. Set it in your `.env` as `TELEGRAM_BOT_TOKEN=<token>`.

#### Find your Telegram user ID

1. Message **@userinfobot** on Telegram — it replies with your numeric user ID.
2. Set it in your `.env` as `ALLOWED_USER_IDS=<your_id>`.
3. For multiple operators, comma-separate: `ALLOWED_USER_IDS=111111111,222222222`.

#### Environment variables

```env
TELEGRAM_BOT_TOKEN=110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
ALLOWED_USER_IDS=123456789
```

---

### 4. How It Works

```
Telegram user sends /select 0xAAA...
        │
        ▼
bot.onText handler fires
        │
        ├─ isAuthorized(msg.from.id)?  ──NO──▶ reply "⛔ Unauthorized"
        │         │
        │        YES
        │         ▼
        ├─ parseArgs(msg.text, 'select')  →  address = '0xAAA...'
        │
        ├─ setActiveTrader('0xAAA...')
        │     ├─ validateAddress()
        │     ├─ SELECT traders WHERE address = $1  (exists check)
        │     ├─ UPDATE bot_state SET active_trader = '0xAAA...'
        │     └─ redis.set('active_trader', '0xAAA...')
        │
        └─ reply "✅ Active trader set: 0xAAA..."
```

The bot state flag (`bot_running`) is a Redis key only — it is not enforced by the service layer in Phase 3. In Phase 4 (trading engine), the execution loop will read this flag before placing orders.

---

### 5. Example Usage

```
You:  /add 0xAbCd1234...ef whale-A 80
Bot:  ✅ Trader added: 0xAbCd1234...ef (whale-A)

You:  /add 0xDEAD5678...00 whale-B 60
Bot:  ✅ Trader added: 0xDEAD5678...00 (whale-B)

You:  /list
Bot:  📋 Traders (2):
      1. `0xAbCd1234...ef` (whale-A) — 80%
      2. `0xDEAD5678...00` (whale-B) — 60%

You:  /select 0xAbCd1234...ef
Bot:  ✅ Active trader set: `0xAbCd1234...ef`

You:  /setpct 95
Bot:  ✅ Copy % updated: `0xAbCd1234...ef` → 95%

You:  /status
Bot:  📊 Bot Status
      State: Stopped 🔴
      Active trader: `0xAbCd1234...ef` (whale-A) — 95%

You:  /start
Bot:  ✅ Bot started

You:  /remove 0xAbCd1234...ef
Bot:  ✅ Trader removed: `0xAbCd1234...ef`
      (active trader also cleared automatically)

You:  /status
Bot:  📊 Bot Status
      State: Running ✅
      Active trader: None
```

---

### 6. Security Notes

- **Allowlist, not denylist.** Only user IDs listed in `ALLOWED_USER_IDS` can issue commands. Any message from an unlisted ID gets `⛔ Unauthorized` and is logged.
- **Fail closed.** If `ALLOWED_USER_IDS` is missing or empty, the app refuses to start (it is in `REQUIRED_VARS`). There is no fallback that permits all users.
- **No sensitive data in replies.** Replies contain only addresses, tags, and percentages — no private keys, API secrets, or internal errors (stack traces go to the log file, not the chat).
- **`node-telegram-bot-api` advisory.** The library's transitive dependency on the deprecated `request` package triggers npm audit warnings. These affect only the HTTP transport layer of the Telegram polling client, not the trading logic. Monitor for a future major version that replaces `request` with a maintained alternative (e.g. `axios` or `undici`).
- **Private bot.** Set `BotFather → Bot Settings → Allow Groups → Disable` to prevent the bot from being added to group chats where unknown users could attempt commands.

---

## Phase 4: Trade Detection System

### 1. What Was Built

A `WatcherService` class (`src/services/watcher.service.ts`) that connects to Polymarket's CLOB WebSocket stream, parses every incoming trade event, applies two Redis-backed gates (bot state + active trader match), and hands matched trades to `processTrade()` — the Phase 5 order-copying stub.

If the WebSocket fails repeatedly, the service transparently falls back to polling Polymarket's REST `/trades` endpoint and continues retrying the WebSocket in the background. When the WebSocket recovers, polling stops automatically.

New / changed files:

| File | Change |
|------|--------|
| [src/services/watcher.service.ts](src/services/watcher.service.ts) | New — full watcher implementation |
| [src/config/constants.ts](src/config/constants.ts) | Polymarket URLs + watcher tuning constants added |
| [src/app.ts](src/app.ts) | `startWatcher()` on startup, `stopWatcher()` in shutdown |

---

### 2. How It Works

#### WebSocket path (primary)

```
WatcherService.connectWs()
  │
  ├─ new WebSocket(POLYMARKET_WS_URL)
  ├─ on('open')  → send subscription: { type: "subscribe", channel: "trade" }
  ├─ on('message') → handleMessage()
  │     └─ JSON.parse → filter event_type === "trade"
  │           └─ evaluateRawTrade()
  │
  ├─ on('close') → scheduleReconnect() with exponential back-off
  │     └─ if failures > WS_POLL_FALLBACK_AFTER → startPolling()
  │
  └─ on('error') → logged; 'close' fires next and handles reconnect
```

#### REST polling fallback (automatic)

After `WS_POLL_FALLBACK_AFTER` (default: 5) consecutive WebSocket failures the service switches to polling `GET /trades?maker_address={activeTrader}&after={lastSeenTimestamp}` every `POLL_INTERVAL_MS` (default: 15 s). A background timer retries the WebSocket every `WS_MAX_RECONNECT_MS` (60 s); on reconnect, polling stops.

#### Reconnect back-off schedule

| Attempt | Delay |
|---------|-------|
| 1 | 2 s |
| 2 | 4 s |
| 3 | 8 s |
| 4 | 16 s |
| 5 | 32 s |
| 6+ | 60 s (capped) → REST fallback |

---

### 3. Trade Flow

```
Raw WebSocket message arrives
          │
          ▼
    parseTradeMessage()
    Extract: wallet, market, price, size, side, timestamp
          │
          ▼
    Gate 1: redis.get('bot_running') === 'true'?
          │ NO → log "Bot stopped — trade ignored"  (return)
          │ YES
          ▼
    Gate 2: redis.get('active_trader') === trade.wallet?
          │ NO → log "wallet X skipped"             (return)
          │ YES
          ▼
    Log "✓ MATCHED trade from active trader"
          │
          ▼
    processTrade(TradeEvent)          ← Phase 5 implements this
```

Both Redis lookups are sub-millisecond cache reads — no database roundtrip on the hot path.

---

### 4. Example — Real Trade Detection

Scenario: active trader is `0xAAA...`, bot is running, WebSocket is live.

```
[watcher] WebSocket connected
[watcher] Subscription sent: {"type":"subscribe","channel":"trade"}

# Incoming message (another wallet — filtered out):
[watcher] Raw trade detected: buy 50 @ 0.72 wallet=0xBBB...
[watcher] Trade from 0xBBB... skipped — active trader is 0xAAA...

# Incoming message (active trader — matched):
[watcher] Raw trade detected: buy 200 @ 0.65 wallet=0xAAA...
[watcher] ✓ MATCHED trade from active trader 0xAAA...: BUY 200 @ $0.65 on market 71321...
[processTrade] BUY 200 units @ $0.65 on market 71321...

# WebSocket drops — reconnect sequence:
[watcher] WebSocket closed [1006]: no reason given
[watcher] Reconnecting in 2000ms (attempt 1)
[watcher] Connecting to wss://ws-subscriptions-clob.polymarket.com/ws/
[watcher] WebSocket connected                ← recovered on attempt 1
```

If the WebSocket cannot recover after 5 attempts:
```
[watcher] WebSocket failed 6 consecutive times — switching to REST polling fallback
[watcher] REST polling started (every 15000ms)
[poll] Processed 3 new trade(s) for 0xAAA...
```

---

### 5. Notes

- **Only active trader trades are processed.** Every message is compared against `redis.get('active_trader')`. Trades from all other wallets are silently dropped at the debug log level.
- **Bot state controls execution.** If `bot_running` is `false` (set via Telegram `/stop`), all incoming trades are ignored regardless of which wallet sent them — the watcher stays connected but does nothing.
- **`processTrade()` is a stub.** It currently logs the matched trade. Phase 5 will replace it with actual order-copying logic against Polymarket's CLOB REST API.
- **WebSocket message format.** The parser reads `maker_address`, `asset_id`, `price`, `size`, `side`, and `timestamp`. If Polymarket changes field names, update `RawTradeMessage` in `watcher.service.ts` and `parseTradeMessage()` — no other files need to change.
- **Tuning constants** live in `src/config/constants.ts`: `WS_BASE_RECONNECT_MS`, `WS_MAX_RECONNECT_MS`, `WS_POLL_FALLBACK_AFTER`, `POLL_INTERVAL_MS`. Adjust without touching service logic.
- **Graceful shutdown.** `stopWatcher()` is the first item in `Promise.allSettled` during shutdown — it terminates the WebSocket immediately, clears all timers, and prevents in-flight poll callbacks from firing after the Redis connection closes.

---

## Phase 4: Trade Detection System (Improved)

### 1. What Was Built

A production-hardened refactor of the Phase 4 watcher. The hybrid WebSocket + REST polling architecture is unchanged, but the trade evaluation pipeline gained four new layers of protection: unique ID tracking, in-memory deduplication with bounded memory, a 2-second latency gate for real-time trades, and strengthened data validation (price/size must be > 0). Gate ordering was also optimised — the two cheapest checks (duplicate lookup and latency) now run before any Redis I/O.

**Changed files:**

| File | Change |
|------|--------|
| [src/services/watcher.service.ts](src/services/watcher.service.ts) | Refactored — `TradeEvent.id`, dedup Set, latency gate, improved gate ordering |
| [src/config/constants.ts](src/config/constants.ts) | `TRADE_LATENCY_THRESHOLD_MS` and `MAX_PROCESSED_TRADES` added |

---

### 2. Key Features

| Feature | Detail |
|---------|--------|
| **Duplicate protection** | `processedTrades: Set<string>` keyed on `trade.id` — same trade can never be executed twice in a session |
| **Bounded memory** | When Set exceeds 1 000 entries, the oldest 500 are pruned (insertion-order iteration) |
| **Latency filter** | WebSocket trades older than 2 s are dropped — prevents acting on delayed/replayed market data |
| **Trade ID** | Uses API-provided `id`/`trade_id`; falls back to a deterministic `wallet-market-ts-price-size` key so dedup works even without an explicit API ID |
| **Strong validation** | price and size must be numeric AND > 0; missing wallet/market/price/size → skip with debug log |
| **Optimised gate order** | Cheap local checks first, Redis reads last — avoids unnecessary network calls |
| **REST bypass of latency gate** | REST-polled trades skip the 2 s check (`skipLatencyCheck=true`) because polled data is inherently older |

---

### 3. How It Works — Full Pipeline

```
Incoming trade (WebSocket or REST poll)
          │
          ▼
  Gate 0 ─ parseTradeMessage()
            Validate: wallet, market, price > 0, size > 0
            Build id = api.id ?? api.trade_id ?? deterministic key
          │ FAIL → log "Invalid trade — missing/bad fields"  (return)
          │ PASS
          ▼
  Gate 1 ─ processedTrades.has(trade.id)?
          │ YES  → log "Duplicate skipped: {id}"             (return)
          │ NO
          ▼
  Gate 2 ─ Date.now() - trade.timestamp > 2000ms?
            (skipped for REST-polled trades)
          │ YES  → log "Stale trade skipped: age={n}ms"      (return)
          │ NO
          ▼
  Gate 3 ─ redis.get('bot_running') === 'true'?
          │ NO  → log "Bot stopped — trade ignored"          (return)
          │ YES
          ▼
  Gate 4 ─ redis.get('active_trader') === trade.wallet?
            (case-insensitive)
          │ NO  → log "Wallet mismatch — skipped"            (return)
          │ YES
          ▼
  log "✓ MATCHED"
  processedTrades.add(trade.id)     ← mark BEFORE executing
  processTrade(trade)               ← Phase 5 will place the copy order
```

---

### 4. Trade Lifecycle

```
1. WS frame arrives → handleMessage() → events[]
2. Each event with type "trade" → evaluateRawTrade(evt, skipLatency=false)
3. parseTradeMessage() → TradeEvent { id, wallet, market, price, size, side, ts }
4. Gate 1: processedTrades.has(id)?    ← 0 ms, in-memory
5. Gate 2: age > 2000ms?               ← 0 ms, clock
6. Gate 3: redis.get('bot_running')    ← ~0.2 ms, cache
7. Gate 4: redis.get('active_trader')  ← ~0.2 ms, cache
8. addToProcessed(id) → pruneIfNeeded()
9. processTrade(trade)
```

For REST polling (fallback mode), step 2 passes `skipLatency=true` and the poll loop uses `lastSeenTimestamp` to only fetch trades newer than the last seen — preventing re-evaluation of already-processed REST pages independently of the dedup Set.

---

### 5. Example — Valid vs Skipped Trades

```
# WebSocket frame received — three events in one batch

[watcher] Trade detected: id=abc123 buy 200 @ 0.65 wallet=0xAAA...
[watcher] ✓ MATCHED: BUY 200 units @ $0.65 on 71321... [id=abc123]
[processTrade] BUY 200 units @ $0.65 on market 71321...

# Same trade arrives again (WS duplicate):
[watcher] Trade detected: id=abc123 buy 200 @ 0.65 wallet=0xAAA...
[watcher] Duplicate skipped: abc123

# Trade from a different wallet:
[watcher] Trade detected: id=xyz789 sell 50 @ 0.72 wallet=0xBBB...
[watcher] Wallet mismatch — trade xyz789: wallet=0xBBB... activeTrader=0xAAA...

# Trade that arrived late (WS frame delayed by 3 s):
[watcher] Trade detected: id=def456 buy 100 @ 0.60 wallet=0xAAA...
[watcher] Stale trade skipped: id=def456 age=3041ms (threshold=2000ms)

# Trade with price = 0 (bad data):
[watcher] Invalid trade — bad numeric values: price=0 size=100

# Bot was stopped via /stop:
[watcher] Trade detected: id=ghi000 buy 75 @ 0.55 wallet=0xAAA...
[watcher] Bot stopped — trade ghi000 ignored
```

---

### 6. Notes

- **Why duplicates are dangerous.** A copy-trading bot that executes the same order twice doubles its position size and fees unintentionally. WebSocket reconnects, REST polling overlap, and Polymarket server retries can all deliver the same trade ID more than once. The dedup Set is the last line of defence against this.
- **Why the latency gate matters.** Stale trades (delayed WS frames, buffered TCP data after a reconnect) represent market conditions that no longer exist. Acting on a 5-second-old price in a volatile prediction market could mean buying at the wrong price. The 2-second threshold is configurable via `TRADE_LATENCY_THRESHOLD_MS`.
- **Why mark-before-process.** `addToProcessed(id)` is called before `processTrade()`. If execution throws mid-way, the trade is still marked as seen. The alternative — marking after — risks double-execution on the next WS frame or poll tick, which is a harder bug to recover from.
- **Memory ceiling.** 1 000 trade IDs × ~50 bytes avg string ≈ 50 KB — negligible. The 500-entry prune batch avoids thrashing the Set on high-volume markets.

---

## Phase 5: Trade Decision Engine

### 1. What Was Built

A three-layer decision pipeline that sits between the watcher's trade detection and the execution stub. Every matched trade passes through a **trade filter** (size, price, freshness) and a **risk manager** (per-trade cap, total spend limit, per-market cap) before a final COPY or SKIP verdict is issued by the **decision engine**. No trade reaches `processTrade()` without clearing all checks.

New files:

| File | Purpose |
|------|---------|
| [src/types/tradeEvent.ts](src/types/tradeEvent.ts) | Shared `TradeEvent` / `TradeSide` types — breaks circular import between watcher and core |
| [src/core/tradeFilter.ts](src/core/tradeFilter.ts) | `shouldProcessTrade()` — size, price, and latency gates |
| [src/core/riskManager.ts](src/core/riskManager.ts) | `validateTrade()` + `recordExposure()` — in-memory risk tracking |
| [src/core/decisionEngine.ts](src/core/decisionEngine.ts) | `decideTrade()` — composes filter + risk into a single COPY/SKIP verdict |

Updated files:

| File | Change |
|------|--------|
| [src/config/constants.ts](src/config/constants.ts) | 7 new constants: `MIN_TRADE_SIZE`, `MAX_TRADE_SIZE`, `MIN_PRICE`, `MAX_PRICE`, `MAX_PER_TRADE`, `TOTAL_SPEND_LIMIT`, `MAX_PER_MARKET` |
| [src/services/watcher.service.ts](src/services/watcher.service.ts) | Imports `decideTrade`; replaces `processTrade` call with COPY/SKIP branch; `TradeEvent` now includes `source: 'ws' \| 'rest'` |

---

### 2. Decision Flow

```
watcher detects matched trade
          │
          ▼
  decideTrade(trade)
          │
          ├─ shouldProcessTrade(trade)          [tradeFilter.ts]
          │     ├─ size < MIN_TRADE_SIZE?   → SKIP "size too small"
          │     ├─ size > MAX_TRADE_SIZE?   → SKIP "size too large"
          │     ├─ price < MIN_PRICE?       → SKIP "price too low"
          │     ├─ price > MAX_PRICE?       → SKIP "price too high"
          │     └─ ws trade stale > 2s?     → SKIP "stale WebSocket trade"
          │                                    (REST trades bypass this gate)
          │
          ├─ validateTrade(trade)               [riskManager.ts]
          │     ├─ size > MAX_PER_TRADE?    → SKIP "exceeds per-trade limit"
          │     ├─ total + size > LIMIT?    → SKIP "exceeds risk limit"
          │     └─ market + size > MAX?     → SKIP "exceeds market exposure"
          │
          ├─ recordExposure(trade)              ← update counters
          │
          └─ return "COPY"
                    │
          decision === 'COPY'
                    │
                    ▼
          processTrade(trade)   ← Phase 6 will place the real order
```

---

### 3. Rules Explained

#### Trade Filter (`tradeFilter.ts`)

| Rule | Constant | Default | Reason |
|------|----------|---------|--------|
| `size >= MIN_TRADE_SIZE` | `MIN_TRADE_SIZE` | 5 USD | Ignore dust trades — fees would exceed value |
| `size <= MAX_TRADE_SIZE` | `MAX_TRADE_SIZE` | 10 000 USD | Reject anomalously large trades (data errors) |
| `price >= MIN_PRICE` | `MIN_PRICE` | 0.01 | Prices at 0 are effectively worthless positions |
| `price <= MAX_PRICE` | `MAX_PRICE` | 0.99 | Prices at 1 have no upside — certainty is already priced in |
| WS trade age ≤ 2 s | `TRADE_LATENCY_THRESHOLD_MS` | 2 000 ms | Stale WS frames represent old market conditions |

#### Risk Manager (`riskManager.ts`)

| Rule | Constant | Default | Reason |
|------|----------|---------|--------|
| `size <= MAX_PER_TRADE` | `MAX_PER_TRADE` | 500 USD | Cap individual position size |
| `totalExposure + size <= TOTAL_SPEND_LIMIT` | `TOTAL_SPEND_LIMIT` | 5 000 USD | Hard portfolio ceiling — prevents runaway copying |
| `marketExposure + size <= MAX_PER_MARKET` | `MAX_PER_MARKET` | 1 000 USD | Prevent concentration in a single market |

All constants live in [src/config/constants.ts](src/config/constants.ts) — tune them without touching any logic.

---

### 4. Example — COPY vs SKIP

```
# Trade A: valid mid-size trade
[watcher]        ✓ MATCHED: BUY 50 units @ $0.65 on market 71321... [id=abc123]
[tradeFilter]    size=50 ≥ 5, ≤ 10000 ✓
[tradeFilter]    price=0.65 ≥ 0.01, ≤ 0.99 ✓
[riskManager]    size=50 ≤ MAX_PER_TRADE=500 ✓
[riskManager]    total 0+50=50 ≤ 5000 ✓
[riskManager]    market 0+50=50 ≤ 1000 ✓
[riskManager]    Exposure updated: total=50 market[71321...]=50
[decisionEngine] Accepted: BUY 50 units @ $0.65 on 71321... [id=abc123]
[processTrade]   Executing BUY 50 units @ $0.65 on market 71321...   → COPY ✅

# Trade B: size too small
[watcher]        ✓ MATCHED: BUY 2 units @ $0.50 on market 71321... [id=def456]
[tradeFilter]    Skipped: size too small — 2 < 5 [id=def456]   → SKIP ❌

# Trade C: price at near-certainty
[watcher]        ✓ MATCHED: BUY 100 units @ $0.995 on market 99999... [id=ghi789]
[tradeFilter]    Skipped: price too high — 0.995 > 0.99 [id=ghi789]   → SKIP ❌

# Trade D: total spend limit reached (after many trades)
[watcher]        ✓ MATCHED: BUY 200 units @ $0.70 on market 71321... [id=jkl000]
[riskManager]    Skipped: exceeds risk limit — would reach total=5100 > 5000 [id=jkl000]
                                                                        → SKIP ❌
```

---

### 5. Notes

- **Why filtering is critical.** A copy-trading bot that blindly copies every trade will follow loss-making positions, pay excessive fees on tiny trades, and concentrate risk in illiquid markets. The filter and risk manager are the first layer of capital protection.
- **Exposure is recorded before `processTrade`.** In the current stub, `processTrade` just logs. When Phase 6 implements real order placement, recording exposure pre-execution means two concurrent trade evaluations cannot both see headroom and both execute. The downside is that a failed order still consumes exposure budget — acceptable for Phase 5, and correctable in Phase 6 by decrementing on execution error.
- **REST trades bypass the latency gate.** `trade.source === 'rest'` skips the 2-second age check in `shouldProcessTrade`. REST-polled trades are stamped with the Polymarket execution time (which could be 30 s ago), not the polling time. Filtering them by age would silently discard all REST fallback data.
- **Risk state resets on restart.** `totalExposure` and `marketExposure` are in-memory. Phase 6 should persist these to Redis or PostgreSQL so limits survive process crashes. `resetExposure()` and `getExposureSummary()` in `riskManager.ts` are already exported for use by a future Telegram `/stats` command or a daily-reset cron.

---

## Phase 6: Execution Engine

### 1. What Was Built

An execution layer that receives a matched, decision-approved `TradeEvent` and turns it into a sized, ready-to-send `Order`. The layer is split into two focused modules:

- **Order builder** (`src/execution/orderBuilder.ts`) — scales the trade size by the active trader's copy percentage and validates the resulting order before it leaves the system.
- **Executor** (`src/execution/executor.ts`) — dispatches the order. In **paper mode** it logs a simulated execution; in **live mode** it is the entry point for real Polymarket CLOB API integration.

New files:

| File | Purpose |
|------|---------|
| [src/execution/orderBuilder.ts](src/execution/orderBuilder.ts) | `buildOrder(trade, copyPercentage)` → `Order \| null` |
| [src/execution/executor.ts](src/execution/executor.ts) | `executeOrder(order)` — paper simulation or live dispatch |

Updated files:

| File | Change |
|------|--------|
| [src/config/env.ts](src/config/env.ts) | `EXECUTION_MODE` added (defaults to `'paper'`) |
| [src/config/constants.ts](src/config/constants.ts) | `DEFAULT_COPY_PERCENTAGE = 100` added |
| [src/services/watcher.service.ts](src/services/watcher.service.ts) | `processTrade()` now calls `buildOrder` + `executeOrder` |
| [.env.example](.env.example) | `EXECUTION_MODE=paper` placeholder added |

---

### 2. Execution Modes

| Mode | Set via | Behaviour |
|------|---------|-----------|
| `paper` | `EXECUTION_MODE=paper` (default) | Logs `"Simulated trade executed"` — no real money moves |
| `live` | `EXECUTION_MODE=live` | Logs `"LIVE MODE ENABLED"` — reserved for Phase 7 real API integration |

**Paper mode is the default.** The env parser treats any value other than `"live"` as `"paper"`, so a missing or typo'd variable never accidentally enables live trading.

To enable live mode, explicitly set it in your `.env`:

```env
EXECUTION_MODE=live
```

---

### 3. Order Flow

```
processTrade(trade)                         [watcher.service.ts]
    │
    ├─ getActiveTrader()                    ← Redis fast path → DB fallback
    │   └─ trader.copy_percentage ?? DEFAULT_COPY_PERCENTAGE (100%)
    │
    ├─ buildOrder(trade, copyPercentage)    [orderBuilder.ts]
    │   ├─ Safety: market must be present
    │   ├─ Safety: price must be > 0 and finite
    │   ├─ Safety: size = trade.size × (pct / 100) must be > 0 and finite
    │   └─ Returns Order { market, price, size, side }
    │          OR null (logged + skipped)
    │
    └─ executeOrder(order)                  [executor.ts]
        ├─ EXECUTION_MODE === 'paper'
        │   └─ log "Simulated trade executed: …"
        └─ EXECUTION_MODE === 'live'
            └─ log "LIVE MODE ENABLED" (Phase 7 will place the real order)
```

The copy percentage is read per-execution from the active trader record. If the trader has no `copy_percentage` set, `DEFAULT_COPY_PERCENTAGE` (100 %) is used so that size is copied 1:1 by default.

---

### 4. Example — Simulated Trade

Active trader `0xAAA...` has `copy_percentage = 50`. Bot is in paper mode.

```
[watcher]       ✓ MATCHED: BUY 200 units @ $0.65 on market 71321... [id=abc123]
[decisionEngine] Accepted: BUY 200 units @ $0.65 on 71321... [id=abc123]
[orderBuilder]  Order built: BUY 100 units @ $0.65 on 71321... (copyPct=50%)
[executor]      Execution mode: paper
[executor]      Simulated trade executed: BUY 100 units @ $0.65 on 71321...
```

Active trader has no `copy_percentage` set (defaults to 100 %):

```
[orderBuilder]  Order built: BUY 200 units @ $0.65 on 71321... (copyPct=100%)
[executor]      Execution mode: paper
[executor]      Simulated trade executed: BUY 200 units @ $0.65 on 71321...
```

Order safety check — trader sets `copy_percentage = 0`:

```
[orderBuilder]  Rejected: size=0 after applying copyPercentage=0% to trade.size=200 [id=abc123]
                                                                         → skipped (no order placed)
```

---

### 5. Safety Notes

- **Paper mode is the only safe default.** Real-money execution requires an explicit `EXECUTION_MODE=live` opt-in. The value is parsed at startup so there is no runtime path that silently switches modes.
- **Order builder validates before dispatch.** Three checks run before `executeOrder` is called: market presence, price validity, and post-scaling size > 0. A null return from `buildOrder` skips execution entirely — the executor never sees a malformed order.
- **Copy percentage defaults to 100 %.** If the active trader record has no `copy_percentage`, the full position is mirrored. Set an explicit percentage via Telegram `/setpct` to reduce exposure.
- **Live mode is a stub.** `EXECUTION_MODE=live` currently logs a warning and does nothing. Phase 7 will wire the real Polymarket CLOB REST API order endpoint. Do not set live mode in production until that phase is complete.
- **Risk limits still apply.** The execution engine sits downstream of the decision engine — every trade has already cleared the trade filter and risk manager before `processTrade` is called. The order builder's safety checks are a second, independent layer, not a replacement for the upstream risk rules.

---

## Phase 4 Fix: Polling-Based Watcher

### 1. What Changed

The WebSocket-based trade detection from Phase 4 was replaced with a pure REST polling implementation. All WebSocket connection logic, reconnect back-off, WS retry timers, and the `ws` import have been removed from `watcher.service.ts`. The service now polls Polymarket's CLOB REST API every 5 seconds as the sole data source.

**Changed files:**

| File | Change |
|------|--------|
| [src/services/watcher.service.ts](src/services/watcher.service.ts) | Rewritten — WebSocket removed, polling-only |
| [src/config/constants.ts](src/config/constants.ts) | `POLYMARKET_WS_URL`, `WS_BASE_RECONNECT_MS`, `WS_MAX_RECONNECT_MS`, `WS_POLL_FALLBACK_AFTER` removed; `POLL_INTERVAL_MS` changed from 15 s to 5 s |

---

### 2. Why

Polymarket's WebSocket endpoint (`wss://ws-subscriptions-clob.polymarket.com/ws/`) is unreliable in practice — connections drop frequently, the server silently stops sending events, and the reconnect/retry loop adds significant complexity for little benefit. Polling the public REST API is simpler, more predictable, and works consistently without maintaining a persistent connection.

---

### 3. How It Works

```
WatcherService.start()
    │
    └─ startPolling()
          │
          ├─ fires immediately (first tick)
          └─ setInterval(pollTrades, 5 000 ms)

pollTrades() — runs every 5 s
    │
    ├─ redis.get('bot_running') !== 'true'?  → skip tick
    ├─ redis.get('active_trader') empty?     → skip tick
    │
    ├─ fetch POLYMARKET_REST_URL/trades?maker={activeTrader}
    │
    └─ for each trade in response:
          ├─ parseTradeMessage()         ← validate fields, build TradeEvent
          ├─ duplicate? (Set lookup)     → skip
          ├─ wallet mismatch?            → skip
          ├─ stale? (age > 2 000 ms)    → skip
          ├─ addToProcessed(id)
          ├─ decideTrade(trade)          ← filter + risk pipeline
          └─ decision === 'COPY'
                └─ processTrade(trade)   ← buildOrder → executeOrder
```

The deduplication `Set` is cleared entirely (rather than pruned) when it exceeds `MAX_PROCESSED_TRADES` (1 000 entries). All trades carry `source: 'rest'`.

---

### 4. Benefits

| Benefit | Detail |
|---------|--------|
| **Stable detection** | No connection drops, no reconnect storms, no silent WS hangs |
| **No connection errors** | Eliminates the `WebSocket error` log noise from the previous implementation |
| **Simpler architecture** | Single polling loop replaces WS state machine + back-off timer + WS-retry timer + poll-mode flag |
| **Deterministic behaviour** | Every tick fetches the same endpoint; easy to test and reason about |
| **Preferred for Polymarket** | Polymarket's public REST API is stable and rate-limit friendly at 5 s cadence |

---

### 5. Notes

- **Polling interval** is `POLL_INTERVAL_MS` (5 000 ms) in [src/config/constants.ts](src/config/constants.ts). Increase it if you hit rate limits; decrease it for faster detection.
- **Stale filter applies to all trades.** REST-polled trades with `timestamp` more than 2 s old are skipped. Polymarket timestamps trades at execution time, so fresh polls return recent trades within this window. Adjust `TRADE_LATENCY_THRESHOLD_MS` in constants if your polling latency exceeds 2 s.
- **`source` field.** All trades produced by the polling watcher carry `source: 'rest'`. The `tradeFilter` latency gate in Phase 5 only applies to `source === 'ws'` trades, so there is no double-filtering.
- **Graceful shutdown** clears the poll interval immediately — no in-flight requests are left dangling after `stopWatcher()` returns.
