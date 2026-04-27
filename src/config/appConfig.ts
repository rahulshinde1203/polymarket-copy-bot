import { env } from './env';
import { BOT_NAME, VERSION } from './constants';

export const appConfig = {
  name: BOT_NAME,
  version: VERSION,
  env: env.NODE_ENV,
  port: env.PORT,
  healthCheckIntervalMs: 60_000,
} as const;
