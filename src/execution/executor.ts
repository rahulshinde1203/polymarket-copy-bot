import { Side, OrderType } from '@polymarket/clob-client';
import redis from '../infra/cache/redis';
import { Order } from './orderBuilder';
import { getWalletBalance } from './balance';
import { getClobClient } from './polymarketClient';
import { withRetry } from '../utils/helpers';
import logger from '../config/logger';
import { env } from '../config/env';
import { MIN_REQUIRED_BALANCE, EXECUTION_DEDUP_TTL_S } from '../config/constants';

const EXEC_RETRIES = 3;
const EXEC_BASE_DELAY_MS = 1_000;

export async function executeOrder(order: Order): Promise<void> {
  const wallet = env.BOT_WALLET;
  const mode = env.EXECUTION_MODE;

  // ── Execution dedup ─────────────────────────────────────────────────────────
  // Last line of defence against re-execution: even if the watcher's trade:<id>
  // TTL key has expired, a completed execution is recorded here for 1 hour.

  try {
    const alreadyExecuted = await redis.get(`execution:${order.tradeId}`);
    if (alreadyExecuted !== null) {
      logger.warn(
        `[executor] Duplicate execution blocked — trade ${order.tradeId} already executed`,
      );
      return;
    }
  } catch (err) {
    logger.warn(
      `[executor] Redis execution-dedup check failed for trade ${order.tradeId} — proceeding`,
      err instanceof Error ? err : new Error(String(err)),
    );
    // On Redis failure: allow execution to continue — other guards are still active
  }

  // ── Balance check ────────────────────────────────────────────────────────────

  const balance = await getWalletBalance(wallet);
  logger.info(
    `[executor] Wallet balance: $${balance} | Order size: $${order.size}` +
    ` | Min required: $${order.size + MIN_REQUIRED_BALANCE}`,
  );

  if (balance < order.size + MIN_REQUIRED_BALANCE) {
    logger.warn(
      `[executor] Insufficient balance — skipping trade: ` +
      `balance=$${balance} < required=$${order.size + MIN_REQUIRED_BALANCE} ` +
      `(order.size=${order.size} + buffer=${MIN_REQUIRED_BALANCE})`,
    );
    return;
  }

  // ── Slippage check (live mode only) ─────────────────────────────────────────
  // Compare the copied trade's price against the current CLOB mid-price.
  // If the market has moved more than MAX_SLIPPAGE_PCT since the trade was
  // detected, executing at the stale price would cost extra slippage.

  if (mode === 'live') {
    const slippageAllowed = isFinite(env.MAX_SLIPPAGE_PCT) && env.MAX_SLIPPAGE_PCT > 0
      ? env.MAX_SLIPPAGE_PCT
      : 1;

    try {
      const client = getClobClient();
      const midpointResp = await client.getMidpoint(order.market);
      const midPrice = parseFloat(midpointResp?.mid ?? '');

      if (!isNaN(midPrice) && midPrice > 0) {
        const deviationPct = Math.abs(order.price - midPrice) / midPrice * 100;
        logger.info(
          `[executor] Slippage check: order.price=${order.price} mid=${midPrice} ` +
          `deviation=${deviationPct.toFixed(3)}% limit=${slippageAllowed}%`,
        );

        if (deviationPct > slippageAllowed) {
          logger.warn(
            `[executor] Slippage exceeded — skipping trade ${order.tradeId}: ` +
            `deviation=${deviationPct.toFixed(3)}% > limit=${slippageAllowed}%`,
          );
          return;
        }
      } else {
        logger.warn(
          `[executor] Could not fetch mid-price for market ${order.market} — skipping slippage check`,
        );
      }
    } catch (err) {
      logger.warn(
        `[executor] Slippage check failed for trade ${order.tradeId} — skipping order as precaution`,
        err instanceof Error ? err : new Error(String(err)),
      );
      return;
    }
  }

  // ── Retry dispatch ───────────────────────────────────────────────────────────
  // withRetry logs "[executor] Attempt N/M failed — retrying in Xms" on each
  // retry and "[executor] Failed after N attempt(s)" on final failure.

  let attemptCount = 0;

  const dispatch = async (): Promise<void> => {
    attemptCount++;
    logger.info(`[executor] Execution attempt ${attemptCount}`);

    if (mode === 'paper') {
      logger.info(
        `[executor] Simulated trade executed: ${order.side.toUpperCase()} ${order.size} units` +
        ` @ $${order.price} on ${order.market}`,
      );
      return;
    }

    // ── Live: place order via Polymarket CLOB API ────────────────────────────

    const client = getClobClient();

    const userOrder = {
      tokenID: order.market,
      price: order.price,
      size: order.size,
      side: order.side === 'buy' ? Side.BUY : Side.SELL,
    };

    logger.info(
      `[executor] Placing live order: ${userOrder.side} ${userOrder.size} units` +
      ` @ $${userOrder.price} tokenID=${userOrder.tokenID}`,
    );

    const response = await client.createAndPostOrder(userOrder, undefined, OrderType.GTC);

    const orderId: string = (response as { orderID?: string; order_id?: string }).orderID
      ?? (response as { orderID?: string; order_id?: string }).order_id
      ?? 'unknown';

    logger.info(
      `[executor] Order accepted by Polymarket: orderId=${orderId} trade=${order.tradeId}`,
    );
  };

  try {
    await withRetry(dispatch, {
      retries: EXEC_RETRIES,
      delayMs: EXEC_BASE_DELAY_MS,
      label: 'executor',
    });

    logger.info(`[executor] Execution success: trade ${order.tradeId}`);

    // Persist execution record — suppresses duplicate re-execution for 1 hour
    try {
      await redis.set(`execution:${order.tradeId}`, '1', 'EX', EXECUTION_DEDUP_TTL_S);
    } catch (err) {
      logger.warn(
        `[executor] Failed to write execution dedup key for trade ${order.tradeId}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  } catch (err) {
    logger.error(
      `[executor] Execution failed after ${EXEC_RETRIES} retries — trade ${order.tradeId}`,
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err; // propagate so processTrade skips the exposure update
  }
}
