import { ethers } from 'ethers';
import logger from '../config/logger';
import { env } from '../config/env';
import { PAPER_SIMULATED_BALANCE, USDC_ADDRESS_POLYGON } from '../config/constants';

// Minimal ERC-20 ABI — only balanceOf needed
const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];

/**
 * Returns the wallet's USDC balance in USD units (dollar-denominated float).
 *
 * Paper mode: returns PAPER_SIMULATED_BALANCE — no network call.
 * Live mode: queries the native USDC contract on Polygon via ethers.js.
 *   Falls back to 0 on any error so the order is safely rejected rather than
 *   placed with an unknown balance.
 */
export async function getWalletBalance(wallet: string): Promise<number> {
  if (env.EXECUTION_MODE === 'paper') {
    logger.info(
      `[balance] Paper mode — simulated balance: $${PAPER_SIMULATED_BALANCE} ` +
      `for wallet ${wallet || '(not configured)'}`,
    );
    return PAPER_SIMULATED_BALANCE;
  }

  if (!wallet) {
    logger.warn('[balance] BOT_WALLET is not configured — defaulting balance to 0 (order rejected)');
    return 0;
  }

  try {
    const provider = new ethers.JsonRpcProvider(env.RPC_URL);
    const usdc = new ethers.Contract(USDC_ADDRESS_POLYGON, ERC20_ABI, provider);
    const raw: bigint = await (usdc['balanceOf'] as (addr: string) => Promise<bigint>)(wallet);
    // Native USDC uses 6 decimals
    const balance = Number(ethers.formatUnits(raw, 6));
    logger.info(`[balance] Live balance: $${balance} for wallet ${wallet}`);
    return balance;
  } catch (err) {
    logger.warn(
      `[balance] Failed to fetch balance for wallet ${wallet} — defaulting to 0 (order rejected)`,
      err instanceof Error ? err : new Error(String(err)),
    );
    return 0;
  }
}
