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
    }
  }
}
