export interface PairConfig {
  /** Display symbol, e.g. "BTC/USDT". */
  symbol: string;
  name: string;
  /** Exchange-native symbol (no slash), e.g. "BTCUSDT". */
  exchange: string;
}

export const PAIRS: PairConfig[] = [
  { symbol: "BTC/USDT", name: "Bitcoin", exchange: "BTCUSDT" },
  { symbol: "ETH/USDT", name: "Ethereum", exchange: "ETHUSDT" },
  { symbol: "SOL/USDT", name: "Solana", exchange: "SOLUSDT" },
  { symbol: "BNB/USDT", name: "BNB", exchange: "BNBUSDT" },
  { symbol: "XRP/USDT", name: "XRP", exchange: "XRPUSDT" },
  { symbol: "ADA/USDT", name: "Cardano", exchange: "ADAUSDT" },
  { symbol: "DOGE/USDT", name: "Dogecoin", exchange: "DOGEUSDT" },
  { symbol: "AVAX/USDT", name: "Avalanche", exchange: "AVAXUSDT" },
  { symbol: "DOT/USDT", name: "Polkadot", exchange: "DOTUSDT" },
  { symbol: "LINK/USDT", name: "Chainlink", exchange: "LINKUSDT" },
];

export const PAIR_SYMBOLS = PAIRS.map((p) => p.symbol);
export const EXCHANGE_SYMBOLS = PAIRS.map((p) => p.exchange);

export function displayName(symbol: string): string {
  return PAIRS.find((p) => p.symbol === symbol)?.name ?? symbol;
}
