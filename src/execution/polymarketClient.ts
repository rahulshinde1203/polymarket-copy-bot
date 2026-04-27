import { ethers } from 'ethers';
import { ClobClient, Chain, type ApiKeyCreds, type ClobSigner } from '@polymarket/clob-client';
import logger from '../config/logger';
import { env } from '../config/env';
import { POLYMARKET_REST_URL, POLYGON_CHAIN_ID } from '../config/constants';

// ── Ethers v6 → clob-client signer adapter ───────────────────────────────────
// clob-client detects ethers v5 signers by the presence of `_signTypedData`.
// ethers v6 renamed that method to `signTypedData` (positional args, same semantics).
// This adapter bridges the two so the library uses its ethers path, not the viem path.

class EthersV6Adapter {
  constructor(private readonly wallet: ethers.Wallet) {}

  async _signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
  ): Promise<string> {
    return this.wallet.signTypedData(domain as Parameters<ethers.Wallet['signTypedData']>[0], types, value);
  }

  async getAddress(): Promise<string> {
    return this.wallet.getAddress();
  }
}

// ── Lazy singleton ────────────────────────────────────────────────────────────

let _client: ClobClient | null = null;

/**
 * Returns a lazily-initialised ClobClient.
 * Throws if PRIVATE_KEY is missing (called only in live mode).
 */
export function getClobClient(): ClobClient {
  if (_client) return _client;

  if (!env.PRIVATE_KEY) {
    throw new Error('[polymarketClient] PRIVATE_KEY is not configured — required for live execution');
  }

  const wallet = new ethers.Wallet(env.PRIVATE_KEY);
  const adapter = new EthersV6Adapter(wallet);

  const creds: ApiKeyCreds | undefined =
    env.CLOB_API_KEY && env.CLOB_SECRET && env.CLOB_PASSPHRASE
      ? { key: env.CLOB_API_KEY, secret: env.CLOB_SECRET, passphrase: env.CLOB_PASSPHRASE }
      : undefined;

  if (creds) {
    logger.info('[polymarketClient] Initialising CLOB client with L2 API key auth');
  } else {
    logger.warn(
      '[polymarketClient] CLOB API key creds not set — using L1 (on-chain) auth. ' +
      'Set CLOB_API_KEY / CLOB_SECRET / CLOB_PASSPHRASE for faster order submission.',
    );
  }

  _client = new ClobClient(
    POLYMARKET_REST_URL,
    POLYGON_CHAIN_ID as Chain,
    adapter as ClobSigner,
    creds,
  );

  logger.info(`[polymarketClient] CLOB client ready — wallet ${wallet.address}`);
  return _client;
}

/** Resets the singleton (useful in tests). */
export function resetClobClient(): void {
  _client = null;
}
