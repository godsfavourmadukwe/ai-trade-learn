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
  | "delayed"
  | "market-closed"
  | "error";

export interface StreamHealth {
  status: StreamStatus;
  subscribedSymbol: string;
  lastTickAt: number; // epoch ms of last received tick (arrival time)
  dataAgeMs: number; // now - lastTickAt
  reconnectCount: number;
  errors: number;
  lastError: string | null;
  marketStatus: MarketStatus;
  wsConnected: boolean;
  /** Diagnostic counters (debug panel). */
  provider: string;
  messagesReceived: number; // raw WS messages since start
  providerTime: number; // provider timestamp of the last tick
  feedDelayMs: number; // now - providerTime (how old the provider data is)
}

export interface StreamCallbacks {
  onTick?: (tick: StreamTick) => void;
  onHealth?: (health: StreamHealth) => void;
  onCandles?: (symbol: string) => void; // signals consumers to re-read candles
}

const WS_URL = "wss://streamer.finance.yahoo.com";
const STALE_AFTER_MS = 30_000; // no tick for 30s → stale
const CONNECTION_TIMEOUT_MS = 15_000; // socket must open within this
const FORCE_RECONNECT_COOLDOWN_MS = 90_000; // rate-limit watchdog reconnects (no storms)
const FEED_DELAY_THRESHOLD_MS = 90_000; // provider data older than 90s → DELAYED, never LIVE
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export class StockStreamEngine {
  private ws: WebSocket | null = null;
  private symbols = new Set<string>();
  private callbacks: StreamCallbacks = {};
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  private status: StreamStatus = "connecting";
  private lastTickAt = 0;
  private reconnectCount = 0;
  private errors = 0;
  private lastError: string | null = null;
  private wsConnected = false;
  private currentExchange: string | null = null;
  private messagesReceived = 0;
  private providerTime = 0;
  private feedDelayMs = 0;
  private lastForceReconnectAt = 0;

  readonly candles = new CandleAggregator(400);

  start(symbols: string[], callbacks: StreamCallbacks, exchange: string | null = null): void {
    this.callbacks = callbacks;
    this.symbols = new Set(symbols.map((s) => s.toUpperCase()));
    this.currentExchange = exchange;
    this.status = "connecting";
    // Per-subscription tick state must reset on start — otherwise a
    // freshly selected symbol inherits the previous symbol's lastTickAt
    // and shows a false LIVE status before its own ticks arrive.
    this.lastTickAt = 0;
    this.providerTime = 0;
    this.feedDelayMs = 0;
    this.lastError = null;
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
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
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
      this.status = "error";
      this.scheduleReconnect(); // constructor failure must retry, not hang
      return;
    }

    const ws = this.ws;

    // Connection timeout — a socket that never opens is a failure,
    // not a permanently "connecting" state.
    this.connectTimer = setTimeout(() => {
      if (!this.wsConnected && this.ws === ws) {
        this.onError(`connection timeout after ${CONNECTION_TIMEOUT_MS}ms`);
        this.cleanupSocket();
        this.scheduleReconnect();
      }
    }, CONNECTION_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.wsConnected = true;
      this.reconnectAttempt = 0;
      try {
        const sub = JSON.stringify({ subscribe: [...this.symbols] });
        ws.send(sub);
        // Internal diagnostic log (visible in dev console):
        console.info(`[stock-stream] connected — subscription sent: ${sub}`);
      } catch (e) {
        this.onError(e instanceof Error ? e.message : String(e));
      }
      this.emitHealth();
    };

    ws.onmessage = (ev: MessageEvent) => {
      try {
        const raw = typeof ev.data === "string" ? ev.data : "";
        if (!raw) return;
        this.messagesReceived++;
        if (this.messagesReceived <= 2) {
          console.info(`[stock-stream] raw message #${this.messagesReceived}:`, raw.slice(0, 160));
        }
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
        console.warn("[stock-stream] parse failure:", this.lastError);
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
    const now = Date.now();
    this.lastTickAt = now;
    this.providerTime = tick.time;
    this.feedDelayMs = tick.time > 0 ? Math.max(0, now - tick.time) : 0;
    this.lastError = null; // a good tick clears the last error
    if (tick.dayVolume != null) {
      this.candles.applyCumulativeTick(tick.id, tick.price, tick.time, tick.dayVolume);
    } else {
      this.candles.applyTick(tick.id, tick.price, tick.time, 0);
    }
    this.candles.closeCandlesBefore(tick.id, tick.time);
    if (tick.exchange) this.currentExchange = tick.exchange;
    if (this.status !== "market-closed") this.status = "live";
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
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
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

  /** Health evaluation + stale/delayed detection every second. */
  private tickHealth(): void {
    const market = getMarketStatus(Date.now(), this.currentExchange);
    const age = this.lastTickAt > 0 ? Date.now() - this.lastTickAt : Number.POSITIVE_INFINITY;

    if (
      !this.wsConnected &&
      !this.reconnectTimer &&
      this.errors > 0 &&
      this.lastTickAt === 0
    ) {
      // Never connected and not retrying → surface the real failure
      this.status = "error";
    } else if (!market.isOpen) {
      // Outside trading hours prices legitimately do not change —
      // MARKET CLOSED wins over STALE (an idle overnight feed is not stale).
      this.status = "market-closed";
    } else if (!this.wsConnected && this.reconnectTimer) {
      this.status = "reconnecting";
    } else if (this.lastTickAt === 0) {
      this.status = "connecting";
    } else if (age > STALE_AFTER_MS) {
      // Arriving messages stopped → STALE (recovery via watchdog below)
      this.status = "stale";
    } else if (this.feedDelayMs > FEED_DELAY_THRESHOLD_MS) {
      // Messages arrive, but the provider's own timestamps are old —
      // the feed is delayed. Never present delayed data as LIVE.
      this.status = "delayed";
    } else {
      this.status = "live";
    }
    this.emitHealth();
  }

  /** Watchdog: if we were live but went silent mid-session, force reconnect. */
  private watchdog(): void {
    if (this.wsConnected && this.lastTickAt > 0) {
      const now = Date.now();
      const age = now - this.lastTickAt;
      const cooldownOk = now - this.lastForceReconnectAt > FORCE_RECONNECT_COOLDOWN_MS;
      if (age > STALE_AFTER_MS * 2 && cooldownOk && getMarketStatus(now, this.currentExchange).isOpen) {
        // Socket looks alive but silent for 60s during open market → reset.
        // Rate-limited: without a cooldown a quiet-but-healthy symbol would
        // re-trigger this every 5s (lastTickAt never advances), close-storming.
        this.lastForceReconnectAt = now;
        this.reconnectCount++;
        this.lastError = `silent feed (${Math.round(age / 1000)}s) — forced reconnect`;
        this.status = "reconnecting";
        console.warn(`[stock-stream] ${this.lastError}`);
        this.cleanupSocket();
        this.connect();
        this.emitHealth();
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
      provider: "yahoo-streamer",
      messagesReceived: this.messagesReceived,
      providerTime: this.providerTime,
      feedDelayMs: this.feedDelayMs,
    });
  }
}

/** App-wide singleton so multiple components share one socket. */
export const stockStreamEngine = new StockStreamEngine();
