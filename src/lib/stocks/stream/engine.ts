// ============================================================
// STOCK STREAM — Real-time streaming engine
//
// Connects to Yahoo's streamer WebSocket (the same infrastructure
// behind Yahoo Finance live pages), subscribes to the currently
// selected symbol and broadcasts normalized ticks + health.
//
// Guarantees:
//   • exponential-backoff auto-reconnect + resubscribe
//   • stale-feed detection (LIVE is never faked)
//   • market open/closed awareness (no pretend updates)
//   • clean symbol switching (unsubscribe → subscribe)
//   • every displayed value originates from the provider
// ============================================================

import { parseStreamerMessage, type StreamTick } from "./protobuf";
import { CandleAggregator } from "./candles";
import { getMarketStatus, type MarketStatus } from "./market-hours";

export type StreamStatus =
  | "live"
  | "connecting"
  | "reconnecting"
  | "stale"
  | "market-closed"
  | "error";

export interface StreamHealth {
  status: StreamStatus;
  subscribedSymbol: string;
  lastTickAt: number; // epoch ms of last received tick
  dataAgeMs: number; // now - lastTickAt
  reconnectCount: number;
  errors: number;
  lastError: string | null;
  marketStatus: MarketStatus;
  wsConnected: boolean;
}

export interface StreamCallbacks {
  onTick?: (tick: StreamTick) => void;
  onHealth?: (health: StreamHealth) => void;
  onCandles?: (symbol: string) => void; // signals consumers to re-read candles
}

const WS_URL = "wss://streamer.finance.yahoo.com";
const STALE_AFTER_MS = 30_000; // no tick for 30s → stale
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export class StockStreamEngine {
  private ws: WebSocket | null = null;
  private symbols = new Set<string>();
  private callbacks: StreamCallbacks = {};
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  private status: StreamStatus = "connecting";
  private lastTickAt = 0;
  private reconnectCount = 0;
  private errors = 0;
  private lastError: string | null = null;
  private wsConnected = false;
  private currentExchange: string | null = null;

  readonly candles = new CandleAggregator(400);

  start(symbols: string[], callbacks: StreamCallbacks, exchange: string | null = null): void {
    this.callbacks = callbacks;
    this.symbols = new Set(symbols.map((s) => s.toUpperCase()));
    this.currentExchange = exchange;
    this.status = "connecting";
    this.emitHealth();
    this.connect();

    // Health/staleness monitor — ticks every second
    if (!this.healthTimer) {
      this.healthTimer = setInterval(() => this.tickHealth(), 1_000);
    }
    if (!this.watchdogTimer) {
      this.watchdogTimer = setInterval(() => this.watchdog(), 5_000);
    }
  }

  stop(): void {
    if (this.ws) {
      try {
        this.ws.close(1000, "client stop");
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.wsConnected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.status = "connecting";
    this.emitHealth();
  }

  /** Switch symbols without dropping the socket when possible. */
  setSymbols(symbols: string[], exchange: string | null = null): void {
    const next = new Set(symbols.map((s) => s.toUpperCase()));
    if (exchange !== undefined) this.currentExchange = exchange;

    const added = [...next].filter((s) => !this.symbols.has(s));
    const removed = [...this.symbols].filter((s) => !next.has(s));

    this.symbols = next;
    if (this.ws && this.wsConnected) {
      if (removed.length > 0) {
        this.ws.send(JSON.stringify({ unsubscribe: removed }));
      }
      if (added.length > 0) {
        this.ws.send(JSON.stringify({ subscribe: added }));
      }
    } else {
      this.connect(); // not connected — fresh connection will subscribe
    }
    this.emitHealth();
  }

  private connect(): void {
    this.cleanupSocket();
    try {
      this.ws = new WebSocket(WS_URL);
    } catch (e) {
      this.onError(e instanceof Error ? e.message : String(e));
      return;
    }

    const ws = this.ws;

    ws.onopen = () => {
      this.wsConnected = true;
      this.reconnectAttempt = 0;
      try {
        ws.send(JSON.stringify({ subscribe: [...this.symbols] }));
      } catch (e) {
        this.onError(e instanceof Error ? e.message : String(e));
      }
      this.emitHealth();
    };

    ws.onmessage = (ev: MessageEvent) => {
      try {
        const raw = typeof ev.data === "string" ? ev.data : "";
        if (!raw) return;
        // Heartbeat/pong-style control frames arrive as plain base64 too —
        // parseStreamerMessage ignores frames without id+price.
        const ticks = parseStreamerMessage(raw);
        for (const tick of ticks) {
          if (!this.symbols.has(tick.id.toUpperCase())) continue; // ignore foreign symbols
          this.handleTick(tick);
        }
      } catch (e) {
        this.errors++;
        this.lastError = e instanceof Error ? e.message : String(e);
      }
    };

    ws.onerror = () => {
      this.onError("websocket error");
    };

    ws.onclose = () => {
      this.wsConnected = false;
      this.scheduleReconnect();
    };
  }

  private handleTick(tick: StreamTick): void {
    this.lastTickAt = Date.now();
    this.candles.applyTick(tick.id, tick.price, tick.time, 0);
    this.candles.closeCandlesBefore(tick.id, tick.time);
    if (tick.exchange) this.currentExchange = tick.exchange;
    this.callbacks.onTick?.(tick);
    this.callbacks.onCandles?.(tick.id);
    this.emitHealth();
  }

  private onError(msg: string): void {
    this.errors++;
    this.lastError = msg;
    this.emitHealth();
  }

  private cleanupSocket(): void {
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.onopen = null;
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
      this.wsConnected = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt++;
    this.reconnectCount++;
    this.status = "reconnecting";
    this.emitHealth();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Health evaluation + stale detection every second. */
  private tickHealth(): void {
    const market = getMarketStatus(Date.now(), this.currentExchange);
    const age = this.lastTickAt > 0 ? Date.now() - this.lastTickAt : Number.POSITIVE_INFINITY;

    if (this.status === "error") {
      // stay in error until recovery events change it
    } else if (!this.wsConnected && this.reconnectTimer) {
      this.status = "reconnecting";
    } else if (this.lastTickAt === 0) {
      this.status = "connecting";
    } else if (age > STALE_AFTER_MS) {
      this.status = "stale";
    } else if (!market.isOpen) {
      this.status = "market-closed";
    } else {
      this.status = "live";
    }
    this.emitHealth();
  }

  /** Watchdog: if we were live but went silent mid-session, force reconnect. */
  private watchdog(): void {
    if (this.wsConnected && this.lastTickAt > 0) {
      const age = Date.now() - this.lastTickAt;
      if (age > STALE_AFTER_MS * 2 && getMarketStatus(Date.now(), this.currentExchange).isOpen) {
        // Socket looks alive but silent for 60s during open market → reset
        this.cleanupSocket();
        this.connect();
      }
    }
  }

  private emitHealth(): void {
    const market = getMarketStatus(Date.now(), this.currentExchange);
    const age = this.lastTickAt > 0 ? Date.now() - this.lastTickAt : Number.POSITIVE_INFINITY;
    this.callbacks.onHealth?.({
      status: this.status,
      subscribedSymbol: [...this.symbols][0] ?? "",
      lastTickAt: this.lastTickAt,
      dataAgeMs: Number.isFinite(age) ? age : -1,
      reconnectCount: this.reconnectCount,
      errors: this.errors,
      lastError: this.lastError,
      marketStatus: market,
      wsConnected: this.wsConnected,
    });
  }
}

/** App-wide singleton so multiple components share one socket. */
export const stockStreamEngine = new StockStreamEngine();
