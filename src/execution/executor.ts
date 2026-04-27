import { Order } from './orderBuilder';
import logger from '../config/logger';
import { env } from '../config/env';

export async function executeOrder(order: Order): Promise<void> {
  const mode = env.EXECUTION_MODE;
  logger.info(`[executor] Execution mode: ${mode}`);

  if (mode === 'paper') {
    logger.info(
      `[executor] Simulated trade executed: ${order.side.toUpperCase()} ${order.size} units` +
      ` @ $${order.price} on ${order.market}`,
    );
    return;
  }

  // mode === 'live'
  logger.warn('[executor] LIVE MODE ENABLED — real order placement not yet implemented');
  // Phase 7: call Polymarket CLOB REST API here
  //   POST /order with { market, price, size, side }
}
