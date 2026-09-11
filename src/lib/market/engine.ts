// ============================================================
// TRADSLY Market Engine
//
// Event-driven orchestration: providers → candle manager → UI
//
// REST is used for initialization, recovery, and fallback polling
// when WebSocket connections fail.
// WebSocket is the primary live source.
// ============================================================

import { CandleManager } from "./candle-manager";
import { BinanceProvider, BybitProvider, ProviderFailover } from "./providers";
import { EXCHANGE_SYMBOLS, PAIRS } from "./symbols";
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

const HISTORY_LIMIT = 200; // candles seeded per (symbol, interval)
const BACKFILL_LIMIT = 60; // candles fetched to repair a gap
const REST_POLL_INTERVAL_MS = 10_000; // REST polling fallback interval

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
  candles: Record<string, Candle[]>;
  diagnostics: Record<string, Diagnostics>;
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
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seeded = new Set<string>();
  private intervals: Interval[] = ["1m"];
  private connected = false;
  private wsConnectedAtLeastOnce = false;

  constructor() {
    this.binance = new BinanceProvider();
    this.bybit = new BybitProvider();
    this.failover = new ProviderFailover(this.binance, this.bybit);

    this.failover.onTick = (ev) => {
      if (!Number.isFinite(ev.price) || ev.price <= 0) return;
      this.lastTick.set(ev.symbol, ev.price);
      this.lastEvent.set(ev.symbol, ev.eventTime);
      this.dirtySymbols.add(ev.symbol);
      this.wsConnectedAtLeastOnce = true;
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
      this.wsConnectedAtLeastOnce = true;
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
      this.wsConnectedAtLeastOnce = true;
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
      for (const key of this.seeded) {
        const [symbol, interval] = key.split("|") as [string, Interval];
        this.revalidate(symbol, interval, lastEventTime);
      }
      void source;
    };
    this.failover.subscribeSymbols(EXCHANGE_SYMBOLS, intervals);
    this.failover.connect();
    this.seedAll();
    // Wall-clock finalization
    this.finalizeTimer = setInterval(() => this.finalizeAll(), 1000);
    // REST polling fallback — if WS doesn't connect within a few seconds,
    // poll via REST so the user sees data
    this.pollTimer = setInterval(() => this.restPoll(), REST_POLL_INTERVAL_MS);
  }

  disconnect(): void {
    this.connected = false;
    this.failover.disconnect();
    if (this.finalizeTimer) { clearInterval(this.finalizeTimer); this.finalizeTimer = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
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

  // ---- Initialization ----

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

  // ---- REST polling fallback ----
  // If WebSocket is not delivering data, poll via REST every N seconds.
  // This ensures the chart always shows data even in restrictive network environments.

  private async restPoll(): Promise<void> {
    // Only poll if we haven't received WS data recently
    const latestWs = Math.max(0, ...Array.from(this.lastEvent.values()));
    const wsAge = Date.now() - latestWs;
    if (wsAge < REST_POLL_INTERVAL_MS * 2) return; // WS is healthy, skip REST poll

    console.debug("[engine] REST poll fallback — WS data stale");

    // Poll each symbol for 24h ticker + latest price
    for (const pair of PAIRS) {
      try {
        // Fetch latest kline (last 2 candles) to get current price
        const res = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${pair.exchange}&interval=1m&limit=2`
        );
        if (!res.ok) continue;
        const rows = (await res.json()) as unknown[];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        const latestRow = rows[rows.length - 1] as unknown[];
        if (!Array.isArray(latestRow) || latestRow.length < 6) continue;

        const close = Number(latestRow[4]);
        if (!Number.isFinite(close) || close <= 0) continue;

        this.lastTick.set(pair.exchange, close);
        this.lastEvent.set(pair.exchange, Date.now());
        this.dirtySymbols.add(pair.exchange);

        // Update candle store with latest candle
        const candle: Candle = {
          time: Number(latestRow[0]),
          open: Number(latestRow[1]),
          high: Number(latestRow[2]),
          low: Number(latestRow[3]),
          close,
          volume: Number(latestRow[5]),
          closed: true,
        };
        const store = this.candles.getStore(pair.exchange, "1m");
        store.applyKline(candle, Date.now());
        this.dirtyCandles.add(`${pair.exchange}|1m`);
      } catch {
        // REST poll failed for this pair — skip silently
      }
    }

    // Also try Bybit for pairs that Binance REST couldn't reach
    for (const pair of PAIRS) {
      if (this.lastTick.has(pair.exchange) && (Date.now() - (this.lastEvent.get(pair.exchange) ?? 0)) < REST_POLL_INTERVAL_MS) continue;
      try {
        const res = await fetch(
          `https://api.bybit.com/v5/market/kline?category=spot&symbol=${pair.exchange}&interval=1&limit=2`
        );
        if (!res.ok) continue;
        const j = (await res.json()) as { result?: { list?: unknown[][] } };
        const list = j.result?.list ?? [];
        if (list.length === 0) continue;

        const latestRow = list[0]; // Bybit returns descending
        if (!Array.isArray(latestRow) || latestRow.length < 6) continue;

        const close = Number(latestRow[4]);
        if (!Number.isFinite(close) || close <= 0) continue;

        this.lastTick.set(pair.exchange, close);
        this.lastEvent.set(pair.exchange, Date.now());
        this.dirtySymbols.add(pair.exchange);

        const candle: Candle = {
          time: Number(latestRow[0]),
          open: Number(latestRow[1]),
          high: Number(latestRow[2]),
          low: Number(latestRow[3]),
          close,
          volume: Number(latestRow[5]),
          closed: true,
        };
        const store = this.candles.getStore(pair.exchange, "1m");
        store.applyKline(candle, Date.now());
        this.dirtyCandles.add(`${pair.exchange}|1m`);
      } catch {
        // skip
      }
    }

    // Also poll 24h ticker for volume/change stats
    try {
      const res = await fetch("https://api.binance.com/api/v3/ticker/24hr");
      if (res.ok) {
        const tickers = (await res.json()) as Array<{
          symbol: string; lastPrice: string; priceChangePercent: string;
          highPrice: string; lowPrice: string; volume: string; quoteVolume: string; openPrice: string;
        }>;
        for (const t of tickers) {
          const pair = PAIRS.find(p => p.exchange === t.symbol);
          if (!pair) continue;
          const last = Number(t.lastPrice);
          if (!Number.isFinite(last) || last <= 0) continue;
          this.stats.set(pair.exchange, {
            price: last,
            change24hPercent: Number(t.priceChangePercent) || 0,
            high24h: Number(t.highPrice) || last,
            low24h: Number(t.lowPrice) || last,
            volume24h: Number(t.quoteVolume) || 0,
            open24h: Number(t.openPrice) || last,
            lastUpdated: Date.now(),
            source: "binance_rest_poll",
          });
          this.dirtySymbols.add(pair.exchange);
        }
      }
    } catch {
      // ticker poll failed — skip
    }

    this.scheduleEmit();
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
        this.dirtyCandles.add(key);
        this.dirtySymbols.add(symbol);
        this.scheduleEmit();
      }
      void INTERVAL_MS[interval];
    }
  }

  // ---- Snapshot emission (batched) ----

  private scheduleEmit(): void {
    if (this.emitTimer) return;
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
    // If either has received data recently, consider connected
    const anyRecentTick = Array.from(this.lastEvent.values()).some(t => Date.now() - t < 15_000);
    if (anyRecentTick) return "connected";
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

// Module-level singleton
export const marketEngine = new MarketEngine();
