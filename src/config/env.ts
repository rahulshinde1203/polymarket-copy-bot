import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_VARS: string[] = [
  'POSTGRES_URL',
  'REDIS_URL',
  'TELEGRAM_BOT_TOKEN',
  'ALLOWED_USER_IDS',
];

function validateEnv(): void {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateEnv();

export const env = {
  NODE_ENV: (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test',
  LOG_LEVEL: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  POSTGRES_URL: process.env.POSTGRES_URL as string,
  REDIS_URL: process.env.REDIS_URL as string,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN as string,
  // Comma-separated integer Telegram user IDs, e.g. "123456789,987654321"
  ALLOWED_USER_IDS: (process.env.ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0),
  // "paper" simulates trades without placing real orders; "live" enables real execution
  EXECUTION_MODE: (process.env.EXECUTION_MODE === 'live' ? 'live' : 'paper') as 'paper' | 'live',
  // Bot's own wallet address used for balance checks in live mode (optional)
  BOT_WALLET: process.env.BOT_WALLET ?? '',

  // ── Live execution ───────────────────────────────────────────────────────
  // Private key of the bot's trading wallet (0x-prefixed). Required for live mode.
  PRIVATE_KEY: process.env.PRIVATE_KEY ?? '',
  // Polygon JSON-RPC endpoint for on-chain balance reads.
  RPC_URL: process.env.RPC_URL ?? 'https://polygon-rpc.com',
  // Polymarket CLOB API key credentials — obtained via client.createOrDeriveApiKey().
  // If omitted the client falls back to slower L1 (on-chain) auth on every request.
  CLOB_API_KEY: process.env.CLOB_API_KEY ?? '',
  CLOB_SECRET: process.env.CLOB_SECRET ?? '',
  CLOB_PASSPHRASE: process.env.CLOB_PASSPHRASE ?? '',
  // Maximum allowed price deviation from mid-market (%). Overrides the constant default.
  MAX_SLIPPAGE_PCT: parseFloat(process.env.MAX_SLIPPAGE_PCT ?? '1'),
} as const;
