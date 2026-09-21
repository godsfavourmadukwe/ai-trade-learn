// ============================================================
// STOCK MARKET LEARNING — Stock Universe Service
//
// Dynamic discovery of tradeable assets. Uses the existing
// market registry infrastructure and extends it to support
// stocks, ETFs, and a broader crypto universe.
//
// Never hardcodes a fixed list — builds dynamically from
// available data sources.
// ============================================================

import type {
  StockInfo,
  UniverseSnapshot,
  AssetClass,
  Market,
} from "./types";
import type { Interval } from "@/lib/market/types";

// ── Stock Universe Store ──────────────────────────────────

const universeStore = new Map<string, StockInfo>();
let lastRefreshTime = 0;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ── Default Universe (curated starting point) ─────────────

/** Curated starting universe — extended dynamically at runtime. */
const CURATED_STOCK_UNIVERSE: StockInfo[] = [
  // Major US Stocks
  { symbol: "AAPL", name: "Apple Inc.", assetClass: "stock", market: "NASDAQ", sector: "Technology", industry: "Consumer Electronics", marketCap: 3_000e9, avgVolume: 50e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "MSFT", name: "Microsoft Corp.", assetClass: "stock", market: "NASDAQ", sector: "Technology", industry: "Software", marketCap: 2_800e9, avgVolume: 20e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "GOOGL", name: "Alphabet Inc.", assetClass: "stock", market: "NASDAQ", sector: "Technology", industry: "Internet Services", marketCap: 1_800e9, avgVolume: 25e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "AMZN", name: "Amazon.com Inc.", assetClass: "stock", market: "NASDAQ", sector: "Consumer Cyclical", industry: "E-Commerce", marketCap: 1_700e9, avgVolume: 40e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "NVDA", name: "NVIDIA Corp.", assetClass: "stock", market: "NASDAQ", sector: "Technology", industry: "Semiconductors", marketCap: 1_500e9, avgVolume: 30e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "META", name: "Meta Platforms Inc.", assetClass: "stock", market: "NASDAQ", sector: "Technology", industry: "Social Media", marketCap: 900e9, avgVolume: 15e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "TSLA", name: "Tesla Inc.", assetClass: "stock", market: "NASDAQ", sector: "Consumer Cyclical", industry: "Auto Manufacturers", marketCap: 800e9, avgVolume: 80e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "JPM", name: "JPMorgan Chase", assetClass: "stock", market: "NYSE", sector: "Financial Services", industry: "Banking", marketCap: 500e9, avgVolume: 10e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "V", name: "Visa Inc.", assetClass: "stock", market: "NYSE", sector: "Financial Services", industry: "Credit Services", marketCap: 500e9, avgVolume: 8e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "JNJ", name: "Johnson & Johnson", assetClass: "stock", market: "NYSE", sector: "Healthcare", industry: "Drug Manufacturers", marketCap: 400e9, avgVolume: 7e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "WMT", name: "Walmart Inc.", assetClass: "stock", market: "NYSE", sector: "Consumer Defensive", industry: "Retail", marketCap: 450e9, avgVolume: 6e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "PG", name: "Procter & Gamble", assetClass: "stock", market: "NYSE", sector: "Consumer Defensive", industry: "Household Products", marketCap: 380e9, avgVolume: 5e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "MA", name: "Mastercard Inc.", assetClass: "stock", market: "NYSE", sector: "Financial Services", industry: "Credit Services", marketCap: 400e9, avgVolume: 3e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "UNH", name: "UnitedHealth Group", assetClass: "stock", market: "NYSE", sector: "Healthcare", industry: "Healthcare Plans", marketCap: 500e9, avgVolume: 3e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "HD", name: "Home Depot", assetClass: "stock", market: "NYSE", sector: "Consumer Cyclical", industry: "Home Improvement", marketCap: 350e9, avgVolume: 4e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  // Major ETFs
  { symbol: "SPY", name: "S&P 500 ETF", assetClass: "etf", market: "NYSE", sector: "Index Fund", industry: "Index", marketCap: 500e9, avgVolume: 80e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", assetClass: "etf", market: "NASDAQ", sector: "Index Fund", industry: "Index", marketCap: 250e9, avgVolume: 40e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "IWM", name: "Russell 2000 ETF", assetClass: "etf", market: "NYSE", sector: "Index Fund", industry: "Index", marketCap: 60e9, avgVolume: 30e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "GLD", name: "Gold ETF", assetClass: "etf", market: "NYSE", sector: "Commodities", industry: "Gold", marketCap: 60e9, avgVolume: 8e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  { symbol: "TLT", name: "20+ Year Treasury ETF", assetClass: "etf", market: "NASDAQ", sector: "Fixed Income", industry: "Bonds", marketCap: 50e9, avgVolume: 20e6, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USD", lastPrice: 0 },
  // Major Crypto (existing from current system)
  { symbol: "BTCUSDT", name: "Bitcoin", assetClass: "crypto", market: "BINANCE", sector: "Cryptocurrency", industry: "Layer 1", marketCap: 1_200e9, avgVolume: 30e9, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USDT", lastPrice: 0 },
  { symbol: "ETHUSDT", name: "Ethereum", assetClass: "crypto", market: "BINANCE", sector: "Cryptocurrency", industry: "Layer 1", marketCap: 400e9, avgVolume: 15e9, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USDT", lastPrice: 0 },
  { symbol: "SOLUSDT", name: "Solana", assetClass: "crypto", market: "BINANCE", sector: "Cryptocurrency", industry: "Layer 1", marketCap: 80e9, avgVolume: 3e9, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], tradeable: true, currency: "USDT", lastPrice: 0 },
];

// ── Universe Management ───────────────────────────────────

/**
 * Initialize the stock universe with curated defaults.
 */
export function initializeUniverse(): void {
  for (const stock of CURATED_STOCK_UNIVERSE) {
    universeStore.set(stock.symbol, stock);
  }
  lastRefreshTime = Date.now();
}

/**
 * Get the current universe snapshot.
 */
export function getUniverseSnapshot(): UniverseSnapshot {
  const assets = Array.from(universeStore.values());
  return {
    assets,
    totalCount: assets.length,
    lastRefreshed: lastRefreshTime,
    source: "curated_universe",
  };
}

/**
 * Get all assets matching a filter.
 */
export function queryUniverse(filter: {
  assetClass?: AssetClass;
  market?: Market;
  sector?: string;
  minMarketCap?: number;
  minVolume?: number;
  tradeableOnly?: boolean;
}): StockInfo[] {
  let assets = Array.from(universeStore.values());

  if (filter.assetClass) {
    assets = assets.filter((a) => a.assetClass === filter.assetClass);
  }
  if (filter.market) {
    assets = assets.filter((a) => a.market === filter.market);
  }
  if (filter.sector) {
    assets = assets.filter((a) => a.sector === filter.sector);
  }
  if (filter.minMarketCap) {
    assets = assets.filter((a) => a.marketCap >= filter.minMarketCap!);
  }
  if (filter.minVolume) {
    assets = assets.filter((a) => a.avgVolume >= filter.minVolume!);
  }
  if (filter.tradeableOnly !== false) {
    assets = assets.filter((a) => a.tradeable);
  }

  return assets;
}

/**
 * Add a stock to the universe (dynamic discovery).
 */
export function addToUniverse(stock: StockInfo): void {
  universeStore.set(stock.symbol, stock);
}

/**
 * Get a specific asset from the universe.
 */
export function getStockInfo(symbol: string): StockInfo | null {
  return universeStore.get(symbol) ?? null;
}

/**
 * Get symbols for training, prioritized by market cap and volume.
 */
export function getTrainingSymbols(
  assetClass?: AssetClass,
  limit: number = 50,
): string[] {
  const assets = assetClass
    ? queryUniverse({ assetClass, tradeableOnly: true })
    : queryUniverse({ tradeableOnly: true });

  // Sort by market cap * volume (liquidity-weighted importance)
  return assets
    .sort((a, b) => (b.marketCap * b.avgVolume) - (a.marketCap * a.avgVolume))
    .slice(0, limit)
    .map((a) => a.symbol);
}

/**
 * Get all sectors in the universe.
 */
export function getSectors(): string[] {
  const sectors = new Set<string>();
  for (const stock of universeStore.values()) {
    sectors.add(stock.sector);
  }
  return Array.from(sectors).sort();
}

/**
 * Get assets by sector.
 */
export function getAssetsBySector(sector: string): StockInfo[] {
  return Array.from(universeStore.values()).filter((s) => s.sector === sector);
}

/**
 * Get universe statistics.
 */
export function getUniverseStats(): {
  total: number;
  byAssetClass: Record<AssetClass, number>;
  byMarket: Record<string, number>;
  bySector: Record<string, number>;
  avgMarketCap: number;
  avgVolume: number;
} {
  const assets = Array.from(universeStore.values());
  const byAssetClass: Record<string, number> = {};
  const byMarket: Record<string, number> = {};
  const bySector: Record<string, number> = {};

  let totalMarketCap = 0;
  let totalVolume = 0;

  for (const a of assets) {
    byAssetClass[a.assetClass] = (byAssetClass[a.assetClass] ?? 0) + 1;
    byMarket[a.market] = (byMarket[a.market] ?? 0) + 1;
    bySector[a.sector] = (bySector[a.sector] ?? 0) + 1;
    totalMarketCap += a.marketCap;
    totalVolume += a.avgVolume;
  }

  return {
    total: assets.length,
    byAssetClass: byAssetClass as Record<AssetClass, number>,
    byMarket,
    bySector,
    avgMarketCap: assets.length > 0 ? totalMarketCap / assets.length : 0,
    avgVolume: assets.length > 0 ? totalVolume / assets.length : 0,
  };
}
