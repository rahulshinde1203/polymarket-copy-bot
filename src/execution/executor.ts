import { Side, OrderType } from '@polymarket/clob-client';
import redis from '../infra/cache/redis';
import { Order } from './orderBuilder';
import { getWalletBalance } from './balance';
import { getClobClient } from './polymarketClient';
import { getTokenId } from '../services/market.service';
import { getCurrentPrice } from '../services/price.service';
import { withRetry } from '../utils/helpers';
import logger from '../config/logger';
import { env } from '../config/env';
import {
  MIN_REQUIRED_BALANCE,
  EXECUTION_DEDUP_TTL_S,
  DEFAULT_MAX_SLIPPAGE,
  LOW_LIQUIDITY_SLIPPAGE,
  SPREAD_LIQUIDITY_THRESHOLD,
} from '../config/constants';

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
    `[executor] Wallet balance: $${balance} | Order cost: $${order.cost}` +
    ` | Min required: $${order.cost + MIN_REQUIRED_BALANCE}`,
  );

  if (balance < order.cost + MIN_REQUIRED_BALANCE) {
    logger.warn(
      `[executor] Insufficient balance — skipping trade: ` +
      `balance=$${balance} < required=$${order.cost + MIN_REQUIRED_BALANCE} ` +
      `(cost=${order.cost} + buffer=${MIN_REQUIRED_BALANCE})`,
    );
    return;
  }

  // ── Token mapping ────────────────────────────────────────────────────────────
  // Resolve the raw market identifier (asset_id / condition ID) to the CLOB
  // tokenID.  Returns null only on a genuine network failure — skip the trade.

  const tokenId = await getTokenId(order.market);
  if (!tokenId) {
    logger.error(
      `[executor] Token mapping failed — skipping trade ${order.tradeId}` +
      ` (market=${order.market})`,
    );
    return;
  }
  logger.info(`[executor] Token resolved: market=${order.market} → tokenId=${tokenId}`);

  // ── Slippage check ───────────────────────────────────────────────────────────
  // Fetch the current mid-price and reject if the market has drifted more than
  // MAX_SLIPPAGE (5%) from the price recorded in the copied trade.
  // Applies in both paper and live modes — a bad price is a bad price regardless.
  // On price fetch failure the trade is skipped (fail-safe default).

  try {
    const { price: currentPrice, bestBid, bestAsk, spread } = await getCurrentPrice(tokenId, order.side);
    const spreadPct = (spread * 100).toFixed(2);
    const slippage = Math.abs(currentPrice - order.price) / order.price;
    const slippagePct = (slippage * 100).toFixed(2);
    const maxSlippage = spread > SPREAD_LIQUIDITY_THRESHOLD ? LOW_LIQUIDITY_SLIPPAGE : DEFAULT_MAX_SLIPPAGE;

    logger.info(
      `[executor] Orderbook: bestBid=${bestBid} bestAsk=${bestAsk} spread=${spreadPct}%` +
      ` | Slippage: trade.price=${order.price} currentPrice=${currentPrice}` +
      ` slippage=${slippagePct}% limit=${(maxSlippage * 100).toFixed(0)}%` +
      ` tokenId=${tokenId} [trade=${order.tradeId}]`,
    );

    if (slippage > maxSlippage) {
      logger.warn(
        `[executor] Slippage exceeded — skipping trade ${order.tradeId}: ` +
        `${slippagePct}% > ${(maxSlippage * 100).toFixed(0)}%` +
        ` (trade.price=${order.price} currentPrice=${currentPrice} spread=${spreadPct}%)`,
      );
      return;
    }
  } catch (err) {
    logger.warn(
      `[executor] Price fetch failed — skipping trade ${order.tradeId} as precaution`,
      err instanceof Error ? err : new Error(String(err)),
    );
    return;
  }

  // ── Execution guards ──────────────────────────────────────────────────────────
  // Belt-and-suspenders: orderBuilder already validates these, but we guard
  // again here so a future refactor cannot silently bypass the safety check.

  if (order.price <= 0 || order.quantity <= 0) {
    logger.error(
      `[executor] Invalid order params — skipping trade ${order.tradeId}: ` +
      `price=${order.price} quantity=${order.quantity}`,
    );
    return;
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
        `[executor] Simulated trade executed: ${order.side.toUpperCase()}` +
        ` quantity=${order.quantity.toFixed(4)} shares @ $${order.price}` +
        ` cost=$${order.cost.toFixed(4)} USDC | tokenId=${tokenId}`,
      );
      return;
    }

    // ── Live: place order via Polymarket CLOB API ────────────────────────────

    const client = getClobClient();

    const userOrder = {
      tokenID: tokenId,
      price: order.price,
      size: order.quantity,
      side: order.side === 'buy' ? Side.BUY : Side.SELL,
    };

    logger.info(
      `[executor] Placing live order: ${userOrder.side}` +
      ` quantity=${order.quantity.toFixed(4)} shares @ $${order.price}` +
      ` cost=$${order.cost.toFixed(4)} USDC | tokenId=${tokenId}`,
    );

    const response = await client.createAndPostOrder(userOrder, undefined, OrderType.GTC) as {
      success?: boolean;
      orderID?: string;
      order_id?: string;
      errorMsg?: string;
      transactionHash?: string;
    };

    if (!response?.success) {
      throw new Error(
        `[executor] Order not confirmed by Polymarket — trade ${order.tradeId}` +
        (response?.errorMsg ? `: ${response.errorMsg}` : ''),
      );
    }

    const orderId = response.orderID ?? response.order_id ?? 'unknown';
    const txHash = response.transactionHash ?? '';

    logger.info(
      `[executor] Order accepted by Polymarket: orderId=${orderId}` +
      (txHash ? ` txHash=${txHash}` : '') +
      ` trade=${order.tradeId}`,
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
