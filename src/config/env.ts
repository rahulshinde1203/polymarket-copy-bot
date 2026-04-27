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
} as const;
