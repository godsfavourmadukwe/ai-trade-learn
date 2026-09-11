// ============================================================
// TRADSLY Market Engine
//
// Event-driven orchestration: providers → candle manager → UI
//
// State machine:
//   IDLE → CONNECTING → LIVE → STALE → RECONNECTING → LIVE
//                               ↓
//                            ERROR
//
// REST is used for initialization and recovery.
// WebSocket is the primary live source.
// REST polling is a last resort with strict rate limiting.
// ============================================================

import { CandleManager } from "./candle-manager";
import { BinanceProvider, BybitProvider, ProviderFailover } from "./providers";
import { EXCHANGE_SYMBOLS, PAIRS } from "./symbols";
import {
  type Candle,
  type Diagnostics,
  type FeedHealth,
  type Interval,
  type SymbolStats,
  type TickerEvent,
  INTERVAL_MS,
  alignTime,
} from "./types";

const HISTORY_LIMIT = 200;
const BACKFILL_LIMIT = 60;
const REST_POLL_INTERVAL_MS = 15_000;
const REST_POLL_MAX_PAIRS_PER_CYCLE = 2; // rate limit: max 2 pairs per REST poll cycle

// Public market-data endpoint (same data as api.binance.com, no geo-block).
// api.binance.com is only tried as a fallback for regions where vision is unavailable.
const BINANCE_REST_PRIMARY = "https://data-api.binance.vision";
const BINANCE_REST_FALLBACK = "https://api.binance.com";

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
  /** Diagnostics panel data */
  diagnosticsDetail: EngineDiagnosticsDetail;
}

export interface EngineDiagnosticsDetail {
  wsConnected: boolean;
  wsUrl: string;
  wsReconnects: number;
  lastWsMessageAge: number;
  restPollActive: boolean;
  lastRestPollTime: number;
  restPollErrors: number;
  historicalCandlesLoaded: number;
  realtimeUpdatesReceived: number;
  symbolsWithData: number;
  lastSeedAttempt: number;
  seedErrors: number;
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
  private allDirty = false; // flag: emit ALL candle data (not just dirty)
  private finalizeTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seeded = new Set<string>();
  private intervals: Interval[] = ["1m"];
  private connected = false;

  // Diagnostics
  private diag: EngineDiagnosticsDetail = {
    wsConnected: false,
    wsUrl: "",
    wsReconnects: 0,
    lastWsMessageAge: 0,
    restPollActive: false,
    lastRestPollTime: 0,
    restPollErrors: 0,
    historicalCandlesLoaded: 0,
    realtimeUpdatesReceived: 0,
    symbolsWithData: 0,
    lastSeedAttempt: 0,
    seedErrors: 0,
  };
  private pollPairIndex = 0; // round-robin index for rate-limited REST polling
  private lastServerDataTime = 0; // when Convex proxy last delivered data
  private serverDataActive = false; // true once Convex proxy delivers first data
  private restPollBase = BINANCE_REST_PRIMARY; // flipped to fallback if primary 4xx/5xx

  constructor() {
    this.binance = new BinanceProvider();
    this.bybit = new BybitProvider();
    this.failover = new ProviderFailover(this.binance, this.bybit);

    this.failover.onTick = (ev) => {
      if (!Number.isFinite(ev.price) || ev.price <= 0) return;
      this.lastTick.set(ev.symbol, ev.price);
      this.lastEvent.set(ev.symbol, ev.eventTime);
      this.dirtySymbols.add(ev.symbol);
      this.diag.wsConnected = true;
      this.diag.realtimeUpdatesReceived++;
      this.diag.lastWsMessageAge = 0;
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
      this.diag.wsConnected = true;
      this.diag.realtimeUpdatesReceived++;
      this.diag.lastWsMessageAge = 0;
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
      this.diag.wsConnected = true;
      this.diag.realtimeUpdatesReceived++;
      this.diag.lastWsMessageAge = 0;
      this.scheduleEmit();
    };

    this.failover.onHealth = (_source, health, detail) => {
      if (detail) console.debug(`[${_source}] ${health}: ${detail}`);
      if (health === "connected") {
        this.diag.wsConnected = true;
      } else if (health === "error" || health === "reconnecting") {
        this.diag.wsConnected = false;
      }
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
    // Connect the primary only; the secondary stays cold until we know the
    // primary can't deliver data (see warmSecondaryIfPrimaryUnhealthy).
    this.failover.connectPrimary();
    // Emit initial empty state so UI shows loading, not stale data
    this.allDirty = true;
    this.scheduleEmit();
    // Seed historical data
    this.seedAll();
    // Wall-clock finalization
    this.finalizeTimer = setInterval(() => this.finalizeAll(), 1000);
    // REST polling fallback — only after WS has had time to connect
    setTimeout(() => {
      this.pollTimer = setInterval(() => this.restPoll(), REST_POLL_INTERVAL_MS);
    }, 5000); // 5s grace period for WS to connect
    // If the primary WS hasn't produced data, warm the secondary provider.
    setTimeout(() => this.warmSecondaryIfPrimaryUnhealthy(), 15_000);
  }

  private warmSecondaryIfPrimaryUnhealthy(): void {
    if (!this.connected) return;
    const primaryLive =
      this.diag.realtimeUpdatesReceived > 0 &&
      Date.now() - this.lastServerDataTime < 30_000 ||
      this.binance.isLive();
    if (!primaryLive) {
      console.debug("[engine] primary unhealthy — warming Bybit secondary");
      this.failover.connectSecondary();
    }
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
    this.diag.lastSeedAttempt = Date.now();
    try {
      const res = await this.binance.getHistoricalCandles(symbol, interval, HISTORY_LIMIT);
      const store = this.candles.getStore(symbol, interval);
      const { seeded } = store.seedFromHistory(res.candles);
      this.diag.historicalCandlesLoaded += seeded;
      if (seeded > 0) {
        this.dirtyCandles.add(key);
        this.dirtySymbols.add(symbol);
        this.allDirty = true; // send all candles on first load
        this.scheduleEmit();
      }
    } catch (e) {
      console.warn(`[engine] seed failed ${key}`, e);
      this.diag.seedErrors++;
      try {
        const res = await this.bybit.getHistory(symbol, interval, HISTORY_LIMIT);
        const store = this.candles.getStore(symbol, interval);
        const { seeded } = store.seedFromHistory(res.candles);
        this.diag.historicalCandlesLoaded += seeded;
        if (seeded > 0) {
          this.dirtyCandles.add(key);
          this.dirtySymbols.add(symbol);
          this.allDirty = true;
          this.scheduleEmit();
        }
      } catch (e2) {
        console.warn(`[engine] bybit seed also failed ${key}`, e2);
        this.diag.seedErrors++;
      }
    }
  }

  // ---- Recovery ----

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

  // ---- REST polling fallback (rate-limited) ----

  private async restPoll(): Promise<void> {
    // Skip if WS is delivering data
    const latestWs = Math.max(0, ...Array.from(this.lastEvent.values()));
    const wsAge = Date.now() - latestWs;
    if (wsAge < REST_POLL_INTERVAL_MS * 2) return;

    // Skip if no symbols need data
    if (EXCHANGE_SYMBOLS.length === 0) return;

    this.diag.restPollActive = true;
    this.diag.lastRestPollTime = Date.now();

    // Rate limit: poll only 2 pairs per cycle, round-robin
    const startIdx = this.pollPairIndex % EXCHANGE_SYMBOLS.length;
    const pairsToPoll: string[] = [];
    for (let i = 0; i < REST_POLL_MAX_PAIRS_PER_CYCLE && i < EXCHANGE_SYMBOLS.length; i++) {
      pairsToPoll.push(EXCHANGE_SYMBOLS[(startIdx + i) % EXCHANGE_SYMBOLS.length]);
    }
    this.pollPairIndex = (startIdx + REST_POLL_MAX_PAIRS_PER_CYCLE) % EXCHANGE_SYMBOLS.length;

    console.debug(`[engine] REST poll fallback for ${pairsToPoll.join(", ")}`);

    // Fetch 24h ticker for our symbols only (small, fast payload).
    // Use the public market-data endpoint — api.binance.com is geo-blocked in
    // several regions (HTTP 451) and returns an HTML CloudFront error page.
    try {
      const symbolsParam = encodeURIComponent(JSON.stringify(EXCHANGE_SYMBOLS));
      let res = await fetch(`${this.restPollBase}/api/v3/ticker/24hr?symbols=${symbolsParam}`);
      if (!res.ok && this.restPollBase === BINANCE_REST_PRIMARY) {
        this.restPollBase = BINANCE_REST_FALLBACK;
        res = await fetch(`${this.restPollBase}/api/v3/ticker/24hr?symbols=${symbolsParam}`);
      }
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
          this.lastTick.set(pair.exchange, last);
          this.lastEvent.set(pair.exchange, Date.now());
          this.dirtySymbols.add(pair.exchange);
        }
      }
    } catch {
      this.diag.restPollErrors++;
    }

    // Fetch latest kline for each polled pair (rate-limited)
    for (const exchangeSymbol of pairsToPoll) {
      try {
        const res = await fetch(
          `${this.restPollBase}/api/v3/klines?symbol=${exchangeSymbol}&interval=1m&limit=2`
        );
        if (!res.ok) continue;
        const rows = (await res.json()) as unknown[];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        const latestRow = rows[rows.length - 1] as unknown[];
        if (!Array.isArray(latestRow) || latestRow.length < 6) continue;

        const close = Number(latestRow[4]);
        if (!Number.isFinite(close) || close <= 0) continue;

        this.lastTick.set(exchangeSymbol, close);
        this.lastEvent.set(exchangeSymbol, Date.now());
        this.dirtySymbols.add(exchangeSymbol);

        const candle: Candle = {
          time: Number(latestRow[0]),
          open: Number(latestRow[1]),
          high: Number(latestRow[2]),
          low: Number(latestRow[3]),
          close,
          volume: Number(latestRow[5]),
          closed: true,
        };
        const store = this.candles.getStore(exchangeSymbol, "1m");
        store.applyKline(candle, Date.now());
        this.dirtyCandles.add(`${exchangeSymbol}|1m`);
      } catch {
        this.diag.restPollErrors++;
      }
    }

    this.diag.restPollActive = false;
    this.scheduleEmit();
  }

  /** Wall-clock finalization */
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

    // Always include all symbols in the snapshot
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

    // Include candle data: either dirty keys or all keys on full refresh
    const candlesOut: Record<string, Candle[]> = {};
    if (this.allDirty) {
      // Send ALL candle data
      for (const key of this.candles.keys()) {
        const [symbol, interval] = key.split("|") as [string, Interval];
        candlesOut[key] = this.candles.getStore(symbol, interval).all();
      }
    } else {
      // Send only dirty candle data
      for (const key of this.dirtyCandles) {
        const [symbol, interval] = key.split("|") as [string, Interval];
        candlesOut[key] = this.candles.getStore(symbol, interval).all();
      }
    }

    // Update diagnostics
    this.diag.symbolsWithData = Object.values(symbols).filter(s => s.price > 0).length;
    const latestEvent = Math.max(0, ...Array.from(this.lastEvent.values()));
    this.diag.lastWsMessageAge = Date.now() - latestEvent;

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
      diagnosticsDetail: { ...this.diag },
    };

    for (const fn of this.listeners) fn(snapshot);
    this.dirtySymbols.clear();
    this.dirtyCandles.clear();
    this.allDirty = false;
  }

  private primaryHealth(): FeedHealth {
    // Server-side Convex proxy data is the PRIMARY source now
    if (this.serverDataActive && Date.now() - this.lastServerDataTime < 30_000) {
      return "connected";
    }
    // Browser-side WebSocket (may not work in hosted environments)
    const d = this.binance.diagnostics;
    if (d.streamHealth === "connected") return "connected";
    if (this.bybit.diagnostics.streamHealth === "connected") return "connected";
    const anyRecentTick = Array.from(this.lastEvent.values()).some(t => Date.now() - t < 15_000);
    if (anyRecentTick) return "connected";
    // No data from any source
    if (this.serverDataActive) return "stale"; // was live, now stale
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

  getDiagnostics(): EngineDiagnosticsDetail {
    return { ...this.diag };
  }

  // ── Server-side data ingestion (from Convex proxy) ──────

  /**
   * Ingest a ticker snapshot from the Convex server-side proxy.
   * This bypasses browser CORS/CSP restrictions entirely.
   */
  ingestServerTicker(data: {
    symbol: string;
    price: number;
    change24hPercent: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    open24h: number;
    lastUpdate: number;
  }): void {
    if (!Number.isFinite(data.price) || data.price <= 0) return;

    this.stats.set(data.symbol, {
      price: data.price,
      change24hPercent: data.change24hPercent,
      high24h: data.high24h,
      low24h: data.low24h,
      volume24h: data.volume24h,
      open24h: data.open24h,
      lastUpdated: data.lastUpdate,
      source: "convex_proxy",
    });
    this.lastTick.set(data.symbol, data.price);
    this.lastEvent.set(data.symbol, data.lastUpdate);
    this.dirtySymbols.add(data.symbol);
    this.diag.wsConnected = true;
    this.diag.realtimeUpdatesReceived++;
    this.diag.lastWsMessageAge = 0;
    this.lastServerDataTime = Date.now();
    this.serverDataActive = true;
    this.scheduleEmit();
  }

  /**
   * Ingest candles from the Convex server-side proxy.
   * Seeds the candle store on first load, updates incrementally after.
   */
  ingestServerCandles(
    symbol: string,
    interval: Interval,
    candlesData: Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      closed: boolean;
    }>,
  ): void {
    if (candlesData.length === 0) return;
    const key = `${symbol}|${interval}`;
    const store = this.candles.getStore(symbol, interval);
    const isEmpty = store.all().length === 0;

    for (const c of candlesData) {
      const candle: Candle = {
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        closed: c.closed,
      };
      if (isEmpty) {
        store.seedFromHistory([candle]);
      } else {
        store.applyKline(candle, Date.now());
      }
    }

    const latest = candlesData[candlesData.length - 1];
    if (latest && Number.isFinite(latest.close) && latest.close > 0) {
      this.lastTick.set(symbol, latest.close);
      this.lastEvent.set(symbol, Date.now());
      this.dirtySymbols.add(symbol);
    }

    this.dirtyCandles.add(key);
    this.allDirty = true;
    this.diag.historicalCandlesLoaded += candlesData.length;
    this.diag.wsConnected = true;
    this.scheduleEmit();
  }

  /** Mark the feed as connected (called when proxy data arrives). */
  markServerConnected(): void {
    this.diag.wsConnected = true;
    this.serverDataActive = true;
    this.lastServerDataTime = Date.now();
  }
}

// Module-level singleton
export const marketEngine = new MarketEngine();
