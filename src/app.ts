import './config/env'; // validates env vars first — must be the first import
import logger from './config/logger';
import { appConfig } from './config/appConfig';
import { connectPostgres, pool } from './infra/db/postgres';
import { connectRedis, disconnectRedis } from './infra/cache/redis';
import { initBot, stopBot } from './bot/telegram/bot';
import { startWatcher, stopWatcher } from './services/watcher.service';

// ── Graceful shutdown ─────────────────────────────────────────────────────────

let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal} — shutting down gracefully`);

  if (healthCheckTimer !== null) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }

  await Promise.allSettled([
    stopWatcher(),
    stopBot(),
    pool.end(),
    disconnectRedis(),
  ]);

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception — exiting', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error(
    'Unhandled promise rejection — exiting',
    reason instanceof Error ? reason : new Error(String(reason)),
  );
  process.exit(1);
});

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info(`${appConfig.name} v${appConfig.version} starting... [env=${appConfig.env}]`);

  await connectPostgres();
  await connectRedis();
  initBot();
  startWatcher();

  logger.debug('Debug logging is active');

  healthCheckTimer = setInterval(() => {
    logger.info('System healthy');
  }, appConfig.healthCheckIntervalMs);

  healthCheckTimer.unref();
}

main().catch((err: unknown) => {
  logger.error('Fatal error during startup', err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});
