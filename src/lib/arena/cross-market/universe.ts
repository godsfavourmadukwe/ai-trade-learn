// ============================================================
// AI TRADE ARENA — Cross-Market Universe Service
//
// Dynamically discovers related/liquid markets for ANY searched
// pair from the existing market-data registry. No hardcoded
// assets. Provides an async refresh + synchronous cached read so
// the synchronous fusion pipeline can consume context without
// blocking.
// ============================================================

import {
  fetchTickersFor,
  fetchPairCandles,
  exchangeToDisplay,
  type TickerRow,
} from "@/lib/market/registry";
import type { Interval } from "@/lib/market/types";

// ── Config ─────────────────────────────────────────────────

export interface UniverseConfig {
  /** Max markets in the analysis universe (per target). */
  maxUniverseSize: number;
  /** Candle interval used for correlation (1h recommended). */
  correlationInterval: Interval;
  /** Number of candles fetched per universe member. */
  candleLimit: number;
  /** Minimum 24h quote volume to qualify as a universe member. */
  minQuoteVolume24h: number;
  /** Ticker cache TTL (ms). */
  tickerTtlMs: number;
  /** Candle cache TTL (ms). */
  candleTtlMs: number;
}

export const DEFAULT_UNIVERSE_CONFIG: UniverseConfig = {
  maxUniverseSize: 24,
  correlationInterval: "1h",
  candleLimit: 168, // 1 week of 1h candles
  minQuoteVolume24h: 10_000_000,
  tickerTtlMs: 5 * 60 * 1000,
  candleTtlMs: 15 * 60 * 1000,
};

// ── Snapshot shape ─────────────────────────────────────────

export interface CrossMarketSnapshot {
  /** Universe members (target self included when its ticker is cached). */
  members: Array<{
    exchangeSymbol: string;
    symbol: string;
    price: number;
    change24hPercent: number;
    quoteVolume24h: number;
  }>;
  /** 1h return series per exchange symbol (oldest→newest). */
  returnSeries: Map<string, number[]>;
  /** Realized vol per exchange symbol (std of returns). */
  volatility: Map<string, number>;
  /** When the snapshot was built. */
  refreshedAt: number;
  /** Whether all refreshes so far succeeded. */
  healthy: boolean;
  /** Symbols whose candles are fresh in the cache. */
  symbolsWithCandles: number;
}

/**
 * Service that keeps a rolling universe of liquid markets for
 * cross-market analysis. Refreshes are deduplicated in-flight and
 * failures preserve previous cached data — never throws.
 */
export class CrossMarketUniverseService {
  private config: UniverseConfig;
  private tickerCache = new Map<string, TickerRow>();
  private tickersFetchedAt = 0;
  private candleCache = new Map<string, Array<{ close: number; time: number }>>();
  private candlesFetchedAt = new Map<string, number>();
  private inFlightTickers: Promise<void> | null = null;
  private inFlightCandles = new Map<string, Promise<void>>();
  private lastError: string | null = null;
  private snapshot: CrossMarketSnapshot | null = null;

  constructor(config?: Partial<UniverseConfig>) {
    this.config = { ...DEFAULT_UNIVERSE_CONFIG, ...config };
  }

  /** Update configuration. */
  updateConfig(partial: Partial<UniverseConfig>): void {
    Object.assign(this.config, partial);
  }

  /**
   * Refresh universe tickers for the given symbols (async, deduplicated).
   * Falls back to cached data on failure.
   */
  async refreshTickers(seedSymbols: string[]): Promise<void> {
    if (this.inFlightTickers) return this.inFlightTickers;
    const p = (async () => {
      try {
        const rows = await fetchTickersFor(seedSymbols);
        if (rows.size > 0) {
          this.tickerCache = rows;
          this.tickersFetchedAt = Date.now();
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : "ticker refresh failed";
      }
    })();
    this.inFlightTickers = p;
    try {
      await p;
    } finally {
      this.inFlightTickers = null;
    }
  }

  /**
   * Fetch + cache candles for one universe member (async, deduplicated).
   * Failures leave the previous cache intact.
   */
  async refreshCandles(exchangeSymbol: string): Promise<void> {
    const existing = this.inFlightCandles.get(exchangeSymbol);
    if (existing) return existing;
    const p = (async () => {
      try {
        const candles = await fetchPairCandles(
          exchangeSymbol,
          this.config.correlationInterval,
          this.config.candleLimit,
        );
        if (candles.length > 0) {
          this.candleCache.set(
            exchangeSymbol,
            candles.map((c) => ({ close: c.close, time: c.time })),
          );
          this.candlesFetchedAt.set(exchangeSymbol, Date.now());
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : "candle refresh failed";
      }
    })();
    this.inFlightCandles.set(exchangeSymbol, p);
    try {
      await p;
    } finally {
      this.inFlightCandles.delete(exchangeSymbol);
    }
  }

  /** True when a symbol has fresh-enough candles cached. */
  hasFreshCandles(exchangeSymbol: string): boolean {
    const at = this.candlesFetchedAt.get(exchangeSymbol) ?? 0;
    return this.candleCache.has(exchangeSymbol) && Date.now() - at < this.config.candleTtlMs;
  }

  /** True when tickers are fresh-enough. */
  hasFreshTickers(): boolean {
    return this.tickerCache.size > 0 && Date.now() - this.tickersFetchedAt < this.config.tickerTtlMs;
  }

  /** Cached ticker for one symbol (may be undefined). */
  getCachedTicker(exchangeSymbol: string): TickerRow | undefined {
    return this.tickerCache.get(exchangeSymbol);
  }

  /** Last error from refreshes (null when healthy). */
  getLastError(): string | null {
    return this.lastError;
  }

  /** Number of symbols with cached candles. */
  getCandleCacheSize(): number {
    return this.candleCache.size;
  }

  /**
   * Build a CrossMarketSnapshot for the target pair and candidate
   * universe symbols. Uses cached data only — call the refresh
   * methods first. Pure read; never fetches.
   */
  buildSnapshot(
    targetExchangeSymbol: string,
    candidates: Array<{ exchangeSymbol: string; symbol: string }>,
  ): CrossMarketSnapshot {
    const members: CrossMarketSnapshot["members"] = [];
    const returnSeries = new Map<string, number[]>();
    const volatility = new Map<string, number>();

    // Self must be included (context engine needs target ticker)
    const selfTicker = this.tickerCache.get(targetExchangeSymbol);
    if (selfTicker) {
      members.push({
        exchangeSymbol: selfTicker.symbol,
        symbol: exchangeToDisplay(selfTicker.symbol) ?? targetExchangeSymbol,
        price: selfTicker.price,
        change24hPercent: selfTicker.change24hPercent,
        quoteVolume24h: selfTicker.quoteVolume24h,
      });
    }

    for (const cand of candidates) {
      if (cand.exchangeSymbol === targetExchangeSymbol) continue;
      const t = this.tickerCache.get(cand.exchangeSymbol);
      if (!t) continue;
      members.push({
        exchangeSymbol: t.symbol,
        symbol: cand.symbol || exchangeToDisplay(t.symbol) || cand.exchangeSymbol,
        price: t.price,
        change24hPercent: t.change24hPercent,
        quoteVolume24h: t.quoteVolume24h,
      });
    }

    // Return series + volatility from cached candles
    for (const [sym, candles] of this.candleCache) {
      const rets: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1].close;
        const cur = candles[i].close;
        if (prev > 0 && cur > 0) rets.push((cur - prev) / prev);
      }
      returnSeries.set(sym, rets);
      if (rets.length >= 2) {
        const m = rets.reduce((a, b) => a + b, 0) / rets.length;
        const v = Math.sqrt(rets.reduce((s, r) => s + (r - m) ** 2, 0) / (rets.length - 1));
        volatility.set(sym, v);
      }
    }

    this.snapshot = {
      members: members.slice(0, this.config.maxUniverseSize),
      returnSeries,
      volatility,
      refreshedAt: Date.now(),
      healthy: this.lastError === null,
      symbolsWithCandles: this.candleCache.size,
    };
    return this.snapshot;
  }

  /** Get the last built snapshot (may be null). */
  getSnapshot(): CrossMarketSnapshot | null {
    return this.snapshot;
  }

  /** Clear all caches (used by tests). */
  reset(): void {
    this.tickerCache.clear();
    this.tickersFetchedAt = 0;
    this.candleCache.clear();
    this.candlesFetchedAt.clear();
    this.inFlightTickers = null;
    this.inFlightCandles.clear();
    this.lastError = null;
    this.snapshot = null;
  }
}

// ── Module-level singleton (shared by the arena engine) ────
export const crossMarketUniverseService = new CrossMarketUniverseService();
