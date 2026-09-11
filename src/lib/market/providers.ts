import {
  type BookTopEvent,
  type Candle,
  type Diagnostics,
  type FeedHealth,
  type HistoricalCandlesResult,
  type Interval,
  type KlineEvent,
  type MarketDataProvider,
  type TickerEvent,
  type TickEvent,
  alignTime,
  isValidCandle,
} from "./types";

// Shared provider plumbing: watchdog, backoff, heartbeat, latency

const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const WATCHDOG_STALE_MS = 20_000; // no messages for 20s → consider stale
const WATCHDOG_TICK_MS = 2_000;

export abstract class BaseProvider implements MarketDataProvider {
  abstract readonly name: string;

  onKline?: (ev: KlineEvent) => void;
  onTick?: (ev: TickEvent) => void;
  onBookTop?: (ev: BookTopEvent) => void;
  onTicker?: (ev: TickerEvent) => void;
  onHealth?: (health: FeedHealth, detail?: string) => void;
  onReconnect?: (lastEventTimeBeforeDrop: number | null) => void;

  diagnostics: Diagnostics = {
    exchange: "", connection: "connecting", streamHealth: "connecting",
    lastEventTime: null, lastReceiveTime: null, lastRenderTime: null,
    latency: null, reconnects: 0, dataGapsDetected: 0, invalidMessages: 0,
    lastHeartbeat: null, activeProvider: null,
  };

  protected ws: WebSocket | null = null;
  protected wantConnected = false;
  protected reconnectAttempt = 0;
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected watchdogTimer: ReturnType<typeof setInterval> | null = null;
  protected lastMessageAt = 0;
  protected lastEventTimeBeforeDrop: number | null = null;
  protected serverTimeOffsetMs: number | null = null;
  protected latestPrices = new Map<string, number>();

  // subclasses implement
  protected abstract wsUrl(): string;
  protected abstract onOpen(): void;
  protected abstract onMessage(raw: MessageEvent): void;
  protected abstract buildSubscribePayload(): unknown | null;
  protected abstract parse(payload: unknown): void;
  protected abstract restKlineUrl(symbol: string, interval: Interval, limit: number): string;
  protected abstract parseKlineArray(a: unknown[]): Candle | null;
  abstract getLatestPrice(symbol: string): number | null;
  abstract subscribeSymbols(symbols: string[], intervals: Interval[]): void;
  abstract unsubscribeSymbols(symbols: string[], intervals: Interval[]): void;

  connect(): void {
    if (this.ws) return;
    this.wantConnected = true;
    this.openSocket();
    this.startWatchdog();
  }

  disconnect(): void {
    this.wantConnected = false;
    this.stopWatchdog();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.diagnostics.connection = "connecting";
  }

  protected openSocket(): void {
    try {
      const ws = new WebSocket(this.wsUrl());
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.lastMessageAt = Date.now();
        const wasReconnect = this.lastEventTimeBeforeDrop !== null;
        this.diagnostics.connection = "connected";
        this.diagnostics.streamHealth = "connected";
        this.onHealth?.("connected");
        this.onOpen();
        if (wasReconnect) {
          this.onReconnect?.(this.lastEventTimeBeforeDrop);
          this.lastEventTimeBeforeDrop = null;
        }
      };

      ws.onmessage = (evt) => {
        this.lastMessageAt = Date.now();
        this.diagnostics.lastReceiveTime = Date.now();
        this.diagnostics.lastHeartbeat = Date.now();
        try {
          this.onMessage(evt);
        } catch (e) {
          this.diagnostics.invalidMessages++;
          console.warn(`[${this.name}] handler error`, e);
        }
      };

      ws.onerror = () => {
        this.onHealth?.("error", "socket error");
      };

      ws.onclose = () => {
        this.lastEventTimeBeforeDrop = this.diagnostics.lastEventTime;
        this.diagnostics.connection = "reconnecting";
        this.diagnostics.streamHealth = "reconnecting";
        this.onHealth?.("reconnecting", "socket closed");
        this.scheduleReconnect();
      };
    } catch (e) {
      console.warn(`[${this.name}] open failed`, e);
      this.scheduleReconnect();
    }
  }

  protected scheduleReconnect(): void {
    if (!this.wantConnected) return;
    if (this.reconnectTimer) return;
    const delay = BACKOFF_STEPS_MS[Math.min(this.reconnectAttempt, BACKOFF_STEPS_MS.length - 1)];
    this.reconnectAttempt++;
    this.diagnostics.reconnects++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantConnected) this.openSocket();
    }, delay);
  }

  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      if (!this.wantConnected) return;
      const sinceMsg = Date.now() - this.lastMessageAt;
      if (sinceMsg > WATCHDOG_STALE_MS) {
        if (this.diagnostics.streamHealth !== "stale") {
          this.diagnostics.streamHealth = "stale";
          this.onHealth?.("stale", `no messages for ${Math.round(sinceMsg / 1000)}s`);
        }
        if (sinceMsg > WATCHDOG_STALE_MS * 3) {
          try { this.ws?.close(); } catch { /* noop */ }
        }
      } else if (this.diagnostics.streamHealth === "stale") {
        this.diagnostics.streamHealth = "connected";
        this.onHealth?.("connected", "stream recovered");
      }
    }, WATCHDOG_TICK_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
  }

  protected emitKline(ev: KlineEvent): void {
    this.diagnostics.lastEventTime = ev.eventTime;
    this.onKline?.(ev);
  }

  protected emitTick(ev: TickEvent): void {
    this.latestPrices.set(ev.symbol, ev.price);
    this.diagnostics.lastEventTime = ev.eventTime;
    this.onTick?.(ev);
  }

  protected emitBookTop(ev: BookTopEvent): void {
    this.onBookTop?.(ev);
  }

  protected emitTicker(ev: TickerEvent): void {
    this.diagnostics.lastEventTime = ev.eventTime;
    this.onTicker?.(ev);
  }

  async getHistoricalCandles(symbol: string, interval: Interval, limit: number): Promise<HistoricalCandlesResult> {
    const t0 = Date.now();
    const res = await fetch(this.restKlineUrl(symbol, interval, limit));
    if (!res.ok) throw new Error(`${this.name} klines HTTP ${res.status}`);
    const rows = (await res.json()) as unknown[];
    if (!Array.isArray(rows)) throw new Error(`${this.name} klines: unexpected payload`);
    const candles: Candle[] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const c = this.parseKlineArray(row);
      if (c && isValidCandle(c)) candles.push(c);
      else this.diagnostics.invalidMessages++;
    }
    void t0;
    return { key: { symbol, interval }, candles, serverTime: Date.now() + (this.serverTimeOffsetMs ?? 0) };
  }

  getServerTimeOffsetMs(): number | null {
    return this.serverTimeOffsetMs;
  }

  protected async syncServerTime(url: string): Promise<void> {
    try {
      const t0 = Date.now();
      const res = await fetch(url);
      const j = (await res.json()) as { serverTime?: number; result?: { timeSecond?: number } };
      const serverMs = j.serverTime ?? (j.result?.timeSecond ? j.result.timeSecond * 1000 : undefined);
      if (typeof serverMs === "number") {
        const rtt = Date.now() - t0;
        this.serverTimeOffsetMs = serverMs - (t0 + rtt / 2);
      }
    } catch { /* offset stays null → local clock */ }
  }

  protected async refreshServerTime(): Promise<void> {
    // Subclasses may override to no-op if not needed.
  }
}

// ------------------------------------------------------------
// Binance provider (primary)
// Production WebSocket + REST endpoints
// ------------------------------------------------------------

// Public market-data endpoints (geo-restriction free):
// data-stream.binance.vision / data-api.binance.vision serve the exact same
// market data as binance.com but without regional blocks. api.binance.com is
// kept only as a fallback for regions where it works.
const BINANCE_WS_URLS = [
  "wss://data-stream.binance.vision/stream",
  "wss://stream.binance.com:9443/stream",
  "wss://data-stream.binance.vision/ws",
];

const BINANCE_REST_BASE = "https://data-api.binance.vision";
const BINANCE_REST_FALLBACK = "https://api.binance.com";

export class BinanceProvider extends BaseProvider {
  readonly name = "binance";
  private symbols: string[] = [];
  private intervals: Interval[] = [];
  private wsUrlIndex = 0;
  private restBase = BINANCE_REST_BASE;
  private restTried = false;

  constructor() {
    super();
    this.diagnostics.exchange = "binance";
  }

  protected wsUrl(): string {
    return BINANCE_WS_URLS[this.wsUrlIndex % BINANCE_WS_URLS.length];
  }

  // Cycle to next WS URL on failure
  private cycleWsUrl(): void {
    this.wsUrlIndex++;
    if (this.wsUrlIndex >= BINANCE_WS_URLS.length) {
      // All WS URLs exhausted — fall back to REST polling
      this.restBase =
        this.restBase === BINANCE_REST_BASE ? BINANCE_REST_FALLBACK : BINANCE_REST_BASE;
      this.wsUrlIndex = 0;
    }
  }

  protected onOpen(): void {
    // Don't wait for server time sync — subscribe immediately for faster data
    this.sendSubscribe();
    // Sync server time in background (non-blocking)
    this.syncServerTime(`${this.restBase}/api/v3/time`);
  }

  /** True once the socket is open AND at least one market message arrived. */
  isLive(): boolean {
    return (
      this.ws?.readyState === WebSocket.OPEN &&
      Date.now() - this.lastMessageAt < 30_000 &&
      this.diagnostics.streamHealth === "connected"
    );
  }

  private sendSubscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.symbols.length === 0 || this.intervals.length === 0) return;
    const streams: string[] = [];
    for (const s of this.symbols) {
      const lower = s.toLowerCase();
      streams.push(`${lower}@aggTrade`);
      streams.push(`${lower}@bookTicker`);
      streams.push(`${lower}@ticker`);
      for (const iv of this.intervals) streams.push(`${lower}@kline_${iv}`);
    }
    this.ws.send(JSON.stringify({ method: "SUBSCRIBE", params: streams, id: Date.now() % 1e9 }));
  }

  subscribeSymbols(symbols: string[], intervals: Interval[]): void {
    this.symbols = symbols;
    this.intervals = intervals;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.sendSubscribe();
  }

  unsubscribeSymbols(_symbols: string[], _intervals: Interval[]): void {
    // Not needed for the app's lifetime; kept for interface completeness.
  }

  protected onMessage(raw: MessageEvent): void {
    const msg = JSON.parse(raw.data) as { stream?: string; data?: unknown };
    if (!msg.stream || !msg.data) return;
    const receiveTime = Date.now();
    const d = msg.data as Record<string, unknown>;

    if (msg.stream.endsWith("@aggTrade")) {
      const price = Number(d.p), qty = Number(d.q), evTime = Number(d.T), tradeId = String(d.a ?? "");
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(evTime)) { this.diagnostics.invalidMessages++; return; }
      const symbol = String(d.s ?? "").toUpperCase();
      this.emitTick({
        symbol, price, quantity: qty, notional: price * qty,
        eventTime: evTime, receivedTime: receiveTime, tradeId, source: this.name,
      });
      return;
    }

    if (msg.stream.endsWith("@bookTicker")) {
      const symbol = String(d.s ?? "").toUpperCase();
      const bid = Number(d.b), ask = Number(d.a);
      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) { this.diagnostics.invalidMessages++; return; }
      this.emitBookTop({
        symbol, bid, bidQty: Number(d.B) || 0, ask, askQty: Number(d.A) || 0,
        eventTime: receiveTime, receivedTime: receiveTime, source: this.name,
      });
      return;
    }

    if (msg.stream.endsWith("@ticker")) {
      const symbol = String(d.s ?? "").toUpperCase();
      const last = Number(d.c);
      if (!Number.isFinite(last) || last <= 0) { this.diagnostics.invalidMessages++; return; }
      this.emitTicker({
        symbol,
        lastPrice: last,
        priceChangePercent24h: Number(d.P) || 0,
        high24h: Number(d.h) || last,
        low24h: Number(d.l) || last,
        volume24hBase: Number(d.v) || 0,
        quoteVolume24h: Number(d.q) || 0,
        openPrice24h: Number(d.o) || last,
        eventTime: Number(d.E) || receiveTime,
        receivedTime: receiveTime,
        source: this.name,
      });
      return;
    }

    const kMatch = msg.stream.match(/@kline_(\w+)$/);
    if (kMatch) {
      const k = d.k as Record<string, unknown> | undefined;
      if (!k) { this.diagnostics.invalidMessages++; return; }
      const interval = kMatch[1] as Interval;
      const candle: Candle = {
        time: Number(k.t),
        open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c),
        volume: Number(k.v),
        closed: Boolean(k.x),
      };
      if (!isValidCandle({ ...candle, closed: true })) { this.diagnostics.invalidMessages++; return; }
      this.emitKline({
        symbol: String(d.s ?? "").toUpperCase(), interval, candle,
        eventTime: Number(d.E) || Date.now(), receivedTime: receiveTime, source: this.name,
      });
    }
  }

  protected buildSubscribePayload(): unknown { return null; }
  protected parse(_payload: unknown): void { /* handled inline in onMessage */ }

  protected restKlineUrl(symbol: string, interval: Interval, limit: number): string {
    return `${this.restBase}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  }

  protected parseKlineArray(a: unknown[]): Candle | null {
    if (a.length < 6) return null;
    return {
      time: Number(a[0]), open: Number(a[1]), high: Number(a[2]),
      low: Number(a[3]), close: Number(a[4]), volume: Number(a[5]), closed: true,
    };
  }

  getLatestPrice(symbol: string): number | null {
    return this.latestPrices.get(symbol) ?? null;
  }

  /** Called by engine on repeated primary-URL failures. */
  failover(): void {
    this.cycleWsUrl();
  }
}

// ------------------------------------------------------------
// Bybit provider (failover)
// Production WebSocket + REST endpoints
// ------------------------------------------------------------

const BYBIT_INTERVAL: Record<Interval, string> = {
  "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D",
};

export class BybitProvider extends BaseProvider {
  readonly name = "bybit";
  private symbols: string[] = [];
  private intervals: Interval[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.diagnostics.exchange = "bybit";
  }

  protected wsUrl(): string { return "wss://stream.bybit.com/v5/public/spot"; }

  protected onOpen(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const args: string[] = [];
    for (const s of this.symbols) {
      args.push(`publicTrade.${s}`);
      args.push(`tickers.${s}`);
      for (const iv of this.intervals) args.push(`kline.${BYBIT_INTERVAL[iv]}.${s}`);
    }
    this.ws.send(JSON.stringify({ op: "subscribe", args }));
    // Start ping interval
    if (!this.pingTimer) {
      this.pingTimer = setInterval(() => this.heartbeat(), 20_000);
    }
  }

  private heartbeat(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "ping" }));
    }
  }

  subscribeSymbols(symbols: string[], intervals: Interval[]): void {
    this.symbols = symbols;
    this.intervals = intervals;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.onOpen();
  }

  unsubscribeSymbols(_symbols: string[], _intervals: Interval[]): void { /* lifetime subscription */ }

  protected onMessage(raw: MessageEvent): void {
    const msg = JSON.parse(raw.data) as Record<string, unknown>;
    const receiveTime = Date.now();

    if (msg.op === "pong" || msg.ret_msg === "OK") {
      this.diagnostics.lastHeartbeat = receiveTime;
      return;
    }

    const topic = String(msg.topic ?? "");
    const ts = Number(msg.ts) || receiveTime;

    if (topic.startsWith("publicTrade.")) {
      const list = msg.data as Array<{ p?: string; v?: string; T?: string; i?: string }> | undefined;
      if (!Array.isArray(list)) { this.diagnostics.invalidMessages++; return; }
      const symbol = topic.split(".")[1] ?? "";
      for (const t of list) {
        const price = Number(t.p);
        if (!Number.isFinite(price) || price <= 0) { this.diagnostics.invalidMessages++; continue; }
        const qty = Number(t.v) || 0;
        this.emitTick({
          symbol, price, quantity: qty, notional: price * qty,
          eventTime: Number(t.T) || ts, receivedTime: receiveTime, tradeId: t.i, source: this.name,
        });
      }
      return;
    }

    if (topic.startsWith("tickers.")) {
      const d = msg.data as Record<string, unknown> | undefined;
      if (!d) { this.diagnostics.invalidMessages++; return; }
      const symbol = topic.split(".")[1] ?? "";
      const last = Number(d.lastPrice);
      if (!Number.isFinite(last) || last <= 0) { this.diagnostics.invalidMessages++; return; }
      const open = Number(d.price24hAgo ?? d.openPrice ?? 0);
      const high = Number(d.highPrice24h ?? 0);
      const low = Number(d.lowPrice24h ?? 0);
      const turnover = Number(d.turnover24h ?? 0);
      this.emitTicker({
        symbol,
        lastPrice: last,
        priceChangePercent24h:
          open > 0 ? ((last - open) / open) * 100 : Number(d.price24hPcnt) * 100 || 0,
        high24h: high > 0 ? high : last,
        low24h: low > 0 ? low : last,
        volume24hBase: Number(d.volume24h ?? 0),
        quoteVolume24h: turnover,
        openPrice24h: open > 0 ? open : last,
        eventTime: ts,
        receivedTime: receiveTime,
        source: this.name,
      });
      return;
    }

    if (topic.startsWith("kline.")) {
      const parts = topic.split(".");
      const bybitIv = parts[1];
      const symbol = parts[2] ?? "";
      const rows = msg.data as Array<[string, string, string, string, string, string, string, boolean]> | undefined;
      if (!Array.isArray(rows)) { this.diagnostics.invalidMessages++; return; }
      const interval = (Object.keys(BYBIT_INTERVAL) as Interval[]).find(k => BYBIT_INTERVAL[k] === bybitIv);
      if (!interval) { this.diagnostics.invalidMessages++; return; }
      for (const row of rows) {
        const candle: Candle = {
          time: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
          low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), closed: Boolean(row[6]),
        };
        if (!isValidCandle({ ...candle, closed: true })) { this.diagnostics.invalidMessages++; continue; }
        this.emitKline({ symbol, interval, candle, eventTime: ts, receivedTime: receiveTime, source: this.name });
      }
    }
  }

  protected buildSubscribePayload(): unknown { return null; }
  protected parse(_payload: unknown): void { /* inline */ }

  protected restKlineUrl(symbol: string, interval: Interval, limit: number): string {
    return `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${BYBIT_INTERVAL[interval]}&limit=${limit}`;
  }

  protected async getHistoricalCandlesImpl(symbol: string, interval: Interval, limit: number): Promise<HistoricalCandlesResult> {
    const res = await fetch(this.restKlineUrl(symbol, interval, limit));
    const j = (await res.json()) as { result?: { list?: unknown[][] } };
    const list = j.result?.list ?? [];
    const candles: Candle[] = [];
    for (const row of list) {
      const c: Candle = {
        time: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
        low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), closed: true,
      };
      if (isValidCandle(c)) candles.push(c);
    }
    candles.sort((a, b) => a.time - b.time);
    return { key: { symbol, interval }, candles, serverTime: Date.now() };
  }

  protected parseKlineArray(_a: unknown[]): Candle | null { return null; }

  async getHistory(symbol: string, interval: Interval, limit: number): Promise<HistoricalCandlesResult> {
    return this.getHistoricalCandlesImpl(symbol, interval, limit);
  }

  getLatestPrice(symbol: string): number | null {
    return this.latestPrices.get(symbol) ?? null;
  }
}

// ------------------------------------------------------------
// Failover orchestration
// ------------------------------------------------------------

export class ProviderFailover {
  private primary: BaseProvider;
  private secondary: BaseProvider | null;
  private usingSecondary = false;

  onKline?: (ev: KlineEvent) => void;
  onTick?: (ev: TickEvent) => void;
  onBookTop?: (ev: BookTopEvent) => void;
  onTicker?: (ev: TickerEvent) => void;
  onHealth?: (source: string, health: FeedHealth, detail?: string) => void;
  onReconnect?: (source: string, lastEventTime: number | null) => void;

  constructor(primary: BaseProvider, secondary?: BaseProvider) {
    this.primary = primary;
    this.secondary = secondary ?? null;
    this.wire(primary);
    if (secondary) this.wire(secondary);
  }

  private wire(p: BaseProvider): void {
    p.onKline = (ev) => this.onKline?.(ev);
    p.onTick = (ev) => this.onTick?.(ev);
    p.onBookTop = (ev) => this.onBookTop?.(ev);
    p.onTicker = (ev) => this.onTicker?.(ev);
    p.onHealth = (health, detail) => this.onHealth?.(p.name, health, detail);
    p.onReconnect = (lastT) => this.onReconnect?.(p.name, lastT);
  }

  connect(): void {
    this.primary.connect();
    // The secondary starts cold; engine warms it on demand (connectSecondary)
    // so we don't hold a second socket to a geo-blocked host by default.
  }

  connectPrimary(): void {
    this.primary.connect();
  }

  connectSecondary(): void {
    this.secondary?.connect();
  }

  disconnect(): void {
    this.primary.disconnect();
    this.secondary?.disconnect();
  }

  subscribeSymbols(symbols: string[], intervals: Interval[]): void {
    this.primary.subscribeSymbols(symbols, intervals);
    this.secondary?.subscribeSymbols(symbols, intervals);
  }

  switchToSecondary(): boolean {
    if (!this.secondary || this.usingSecondary) return false;
    this.usingSecondary = true;
    this.primary.disconnect();
    return true;
  }

  activeName(): string {
    return this.usingSecondary ? this.secondary!.name : this.primary.name;
  }

  diagnostics(): Diagnostics {
    return this.usingSecondary ? this.secondary!.diagnostics : this.primary.diagnostics;
  }
}

export { alignTime };
