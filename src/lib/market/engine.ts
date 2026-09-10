// ============================================================
// TRADSLY Market Engine
// Event-driven orchestration: providers → candle manager → UI
//
// REST is used ONLY for initialization, recovery, and backfill.
// All live updates flow through WebSockets:
//   aggTrade/publicTrade → live price
//   kline streams        → forming/closed candle updates
//   ticker streams       → 24h stats
// ============================================================

import { CandleManager } from "./candle-manager";
import { BinanceProvider, BybitProvider, ProviderFailover } from "./providers";
import { EXCHANGE_SYMBOLS } from "./symbols";
import {
  type Candle,
  type Diagnostics,
  type EngineEvent,
  type FeedHealth,
  type Interval,
  type SymbolStats,
  type TickerEvent,
  INTERVAL_MS,
  alignTime,
} from "./types";

const HISTORY_LIMIT = 500; // candles seeded per (symbol, interval)
const BACKFILL_LIMIT = 60; // candles fetched to repair a gap

export interface SymbolSnapshot {
  symbol: string;
  price: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  open24h: number;
  lastTickTime: number | null;
  lastEventTime: number | null;
  stats: SymbolStats | null;
}

export interface EngineSnapshot {
  symbols: Record<string, SymbolSnapshot>;
  candles: Record<string, Candle[]>; // "SYMBOL|interval" → ascending candles
  diagnostics: Record<string, Diagnostics>; // provider name → diagnostics
  activeProvider: string;
  feedHealth: FeedHealth;
  lastUpdate: number;
}

type Listener = (snapshot: EngineSnapshot) => void;

export class MarketEngine {
  private failover: ProviderFailover;
  private binance: BinanceProvider;
  private bybit: BybitProvider;
  private candles = new CandleManager();
  private stats = new Map<string, SymbolStats>();
  private lastTick = new Map<string, number>();
  private lastEvent = new Map<string, number>();
  private listeners = new Set<Listener>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtySymbols = new Set<string>();
  private dirtyCandles = new Set<string>();
  private finalizeTimer: ReturnType<typeof setInterval> | null = null;
  private seeded = new Set<string>(); // "SYMBOL|interval" keys already initialized
  private intervals: Interval[] = ["1m"];
  private connected = false;

  constructor() {
    this.binance = new BinanceProvider();
    this.bybit = new BybitProvider();
    this.failover = new ProviderFailover(this.binance, this.bybit);

    this.failover.onTick = (ev) => {
      if (!Number.isFinite(ev.price) || ev.price <= 0) return;
      this.lastTick.set(ev.symbol, ev.price);
      this.lastEvent.set(ev.symbol, ev.eventTime);
      this.dirtySymbols.add(ev.symbol);
      this.scheduleEmit();
    };

    this.failover.onTicker = (ev: TickerEvent) => {
      this.stats.set(ev.symbol, {
        price: ev.lastPrice,
        change24hPercent: ev.priceChangePercent24h,
        high24h: ev.high24h,
        low24h: ev.low24h,
        volume24h: ev.quoteVolume24h,
        open24h: ev.openPrice24h,
        lastUpdated: ev.receivedTime,
        source: ev.source,
      });
      if (!Number.isFinite(ev.lastPrice) || ev.lastPrice <= 0) return;
      this.lastTick.set(ev.symbol, ev.lastPrice);
      this.lastEvent.set(ev.symbol, ev.eventTime);
      this.dirtySymbols.add(ev.symbol);
      this.scheduleEmit();
    };

    this.failover.onKline = (ev) => {
      const store = this.candles.getStore(ev.symbol, ev.interval);
      const result = store.applyKline(ev.candle, ev.eventTime);
      if (result.status === "ignored") return;
      this.lastTick.set(ev.symbol, ev.candle.close);
      this.lastEvent.set(ev.symbol, ev.eventTime);
      this.dirtySymbols.add(ev.symbol);
      this.dirtyCandles.add(`${ev.symbol}|${ev.interval}`);
      if (result.gapDetected) this.backfill(ev.symbol, ev.interval);
      this.scheduleEmit();
    };

    this.failover.onHealth = (_source, health, detail) => {
      if (detail) console.debug(`[${_source}] ${health}: ${detail}`);
      this.scheduleEmit();
    };
  }

  // ---- Lifecycle ----

  connect(intervals: Interval[]): void {
    this.intervals = intervals;
    if (this.connected) {
      this.failover.subscribeSymbols(EXCHANGE_SYMBOLS, intervals);
      return;
    }
    this.connected = true;
    this.failover.onReconnect = (source, lastEventTime) => {
      // After any reconnect, validate + repair data for all tracked keys.
      for (const key of this.seeded) {
        const [symbol, interval] = key.split("|") as [string, Interval];
        this.revalidate(symbol, interval, lastEventTime);
      }
      void source;
    };
    this.failover.subscribeSymbols(EXCHANGE_SYMBOLS, intervals);
    this.failover.connect();
    this.seedAll();
    // Wall-clock finalization: ensures the forming candle closes on time
    // even if the exchange's kline-close event is delayed.
    this.finalizeTimer = setInterval(() => this.finalizeAll(), 1000);
  }

  disconnect(): void {
    this.connected = false;
    this.failover.disconnect();
    if (this.finalizeTimer) { clearInterval(this.finalizeTimer); this.finalizeTimer = null; }
  }

  changeIntervals(intervals: Interval[]): void {
    this.intervals = intervals;
    this.failover.subscribeSymbols(EXCHANGE_SYMBOLS, intervals);
    for (const symbol of EXCHANGE_SYMBOLS) {
      for (const interval of intervals) {
        void this.seed(symbol, interval);
      }
    }
  }

  // ---- Initialization (REST once, then WebSocket takes over) ----

  private seedAll(): void {
    for (const symbol of EXCHANGE_SYMBOLS) {
      for (const interval of this.intervals) {
        void this.seed(symbol, interval);
      }
    }
  }

  private async seed(symbol: string, interval: Interval): Promise<void> {
    const key = `${symbol}|${interval}`;
    this.seeded.add(key);
    try {
      const res = await this.binance.getHistoricalCandles(symbol, interval, HISTORY_LIMIT);
      const store = this.candles.getStore(symbol, interval);
      store.seedFromHistory(res.candles);
      this.dirtyCandles.add(key);
      this.dirtySymbols.add(symbol);
      this.scheduleEmit();
    } catch (e) {
      console.warn(`[engine] seed failed ${key}`, e);
      // Fall back to Bybit REST for history if Binance REST is blocked.
      try {
        const res = await this.bybit.getHistory(symbol, interval, HISTORY_LIMIT);
        const store = this.candles.getStore(symbol, interval);
        store.seedFromHistory(res.candles);
        this.dirtyCandles.add(key);
        this.dirtySymbols.add(symbol);
        this.scheduleEmit();
      } catch (e2) {
        console.warn(`[engine] bybit seed also failed ${key}`, e2);
      }
    }
  }

  // ---- Recovery & gap repair ----

  private async revalidate(symbol: string, interval: Interval, lastEventTime: number | null): Promise<void> {
    const key = `${symbol}|${interval}`;
    try {
      const res = await this.binance.getHistoricalCandles(symbol, interval, BACKFILL_LIMIT);
      const store = this.candles.getStore(symbol, interval);
      const { merged } = store.mergeBackfill(res.candles);
      if (merged > 0) {
        this.dirtyCandles.add(key);
        this.dirtySymbols.add(symbol);
        this.scheduleEmit();
      }
    } catch (e) {
      console.warn(`[engine] revalidate failed ${key}`, e);
    }
    void lastEventTime;
  }

  private async backfill(symbol: string, interval: Interval): Promise<void> {
    const key = `${symbol}|${interval}`;
    try {
      const res = await this.binance.getHistoricalCandles(symbol, interval, BACKFILL_LIMIT);
      const store = this.candles.getStore(symbol, interval);
      const { merged } = store.mergeBackfill(res.candles);
      if (merged > 0) {
        this.dirtyCandles.add(key);
        this.dirtySymbols.add(symbol);
        this.scheduleEmit();
      }
    } catch (e) {
      console.warn(`[engine] backfill failed ${key}`, e);
    }
  }

  /** Wall-clock finalization of the forming candle at boundary crossings. */
  private finalizeAll(): void {
    const nowMs = Date.now();
    for (const key of this.candles.keys()) {
      const [symbol, interval] = key.split("|") as [string, Interval];
      const store = this.candles.getStore(symbol, interval);
      const boundary = alignTime(nowMs, interval);
      const finalized = store.finalizeIfPeriodEnded(boundary);
      if (finalized) {
        // The next kline event will create the new forming candle; until then
        // expose the just-closed candle as the latest.
        this.dirtyCandles.add(key);
        this.dirtySymbols.add(symbol);
        this.scheduleEmit();
      }
      void INTERVAL_MS[interval];
    }
  }

  // ---- Snapshot emission (batched, never per-tick React churn) ----

  private scheduleEmit(): void {
    if (this.emitTimer) return;
    // Coalesce bursts into one UI update per animation frame (~16ms).
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit();
    }, 16);
  }

  private emit(): void {
    const symbols: Record<string, SymbolSnapshot> = {};
    const candleKeys = this.dirtyCandles.size > 0 ? this.dirtyCandles : null;

    for (const symbol of EXCHANGE_SYMBOLS) {
      const stat = this.stats.get(symbol) ?? null;
      const price = this.lastTick.get(symbol) ?? stat?.price ?? 0;
      symbols[symbol] = {
        symbol,
        price,
        change24hPercent: stat?.change24hPercent ?? 0,
        high24h: stat?.high24h ?? 0,
        low24h: stat?.low24h ?? 0,
        volume24h: stat?.volume24h ?? 0,
        open24h: stat?.open24h ?? 0,
        lastTickTime: this.lastEvent.get(symbol) ?? null,
        lastEventTime: this.lastEvent.get(symbol) ?? null,
        stats: stat,
      };
    }

    const candlesOut: Record<string, Candle[]> = {};
    for (const key of candleKeys ?? []) {
      const [symbol, interval] = key.split("|") as [string, Interval];
      candlesOut[key] = this.candles.getStore(symbol, interval).all();
    }

    const snapshot: EngineSnapshot = {
      symbols,
      candles: candlesOut,
      diagnostics: {
        binance: this.binance.diagnostics,
        bybit: this.bybit.diagnostics,
      },
      activeProvider: this.failover.activeName(),
      feedHealth: this.primaryHealth(),
      lastUpdate: Date.now(),
    };

    for (const fn of this.listeners) fn(snapshot);
    this.dirtySymbols.clear();
    this.dirtyCandles.clear();
  }

  private primaryHealth(): FeedHealth {
    const d = this.binance.diagnostics;
    if (d.streamHealth === "connected") return "connected";
    if (this.bybit.diagnostics.streamHealth === "connected") return "connected";
    return d.streamHealth === "error" || d.streamHealth === "connecting"
      ? this.bybit.diagnostics.streamHealth
      : d.streamHealth;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getCandles(symbol: string, interval: Interval): Candle[] {
    return this.candles.getStore(symbol, interval).all();
  }
}

// Module-level singleton: one engine for the app's lifetime.
export const marketEngine = new MarketEngine();
