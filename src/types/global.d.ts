export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: 'development' | 'production' | 'test';
      LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
      POSTGRES_URL?: string;
      REDIS_URL?: string;
      TELEGRAM_BOT_TOKEN?: string;
      ALLOWED_USER_IDS?: string;
      BOT_WALLET?: string;
      PRIVATE_KEY?: string;
      RPC_URL?: string;
      CLOB_API_KEY?: string;
      CLOB_SECRET?: string;
      CLOB_PASSPHRASE?: string;
      MAX_SLIPPAGE_PCT?: string;
    }
  }
}
