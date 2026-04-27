import Redis from 'ioredis';
import { env } from '../../config/env';
import logger from '../../config/logger';

const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('ready', () => logger.debug('Redis ready'));
redis.on('error', (err: Error) => logger.error('Redis error', err));
redis.on('close', () => logger.warn('Redis connection closed'));

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  logger.info('Redis disconnected');
}

export default redis;
