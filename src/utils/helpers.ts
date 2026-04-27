import logger from '../config/logger';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatCurrency(amount: number, decimals = 2): string {
  return amount.toFixed(decimals);
}

export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  label?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { retries = 3, delayMs = 1000, label = 'operation' } = options;
  const maxAttempts = retries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxAttempts) {
        logger.error(`[${label}] Failed after ${attempt} attempt(s): ${error.message}`);
        throw error;
      }

      const backoff = delayMs * 2 ** (attempt - 1);
      logger.warn(
        `[${label}] Attempt ${attempt}/${maxAttempts} failed: ${error.message} — retrying in ${backoff}ms`,
      );
      await sleep(backoff);
    }
  }

  // Unreachable, but satisfies the TypeScript return-type checker
  throw new Error(`[${label}] Retry loop exited unexpectedly`);
}
