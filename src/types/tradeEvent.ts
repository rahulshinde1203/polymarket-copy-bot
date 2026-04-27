export type TradeSide = 'buy' | 'sell';

export interface TradeEvent {
  id: string;          // Unique trade identifier — used for duplicate protection
  wallet: string;      // Trader's Ethereum address
  market: string;      // Polymarket asset/market ID
  price: number;       // 0–1 (prediction market probability scale)
  size: number;        // USD notional size
  side: TradeSide;
  timestamp: number;   // Unix ms — when the trade occurred on Polymarket
  source: 'ws' | 'rest'; // Whether this trade arrived via WebSocket or REST poll
}
