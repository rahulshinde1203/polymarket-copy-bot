import { Pool, QueryResult, QueryResultRow } from 'pg';
import { env } from '../../config/env';
import logger from '../../config/logger';

export const pool = new Pool({ connectionString: env.POSTGRES_URL });

pool.on('error', (err: Error) => {
  logger.error('Unexpected PostgreSQL client error', err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(sql, params as unknown[]);
}

export async function connectPostgres(): Promise<void> {
  const client = await pool.connect();
  client.release();
  logger.info('PostgreSQL connected');
}
