// ============================================================
// TRADSLY Market Data — core types + provider interface
// Exchange-agnostic. Providers normalize into these shapes.
// ============================================================

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export const INTERVAL_MS: Record<Interval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export const ALL_INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/** UTC-normalized OHLCV candle. Times are epoch ms aligned to interval boundaries. */
export interface Candle {
  time: number; // candle open time (UTC epoch ms, boundary-aligned)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** true once the candle period has ended. Forming candles mutate; closed candles are immutable. */
  closed: boolean;
}

export interface CandleKey {
  symbol: string;
  interval: Interval;
}

export function candleId(symbol: string, interval: Interval, time: number): string {
  return `${symbol}|${interval}|${time}`;
}

/** Normalized live price/tick event (from aggTrade / publicTrade / ticker). */
export interface TickEvent {
  symbol: string;
  price: number;
  quantity: number; // base asset quantity
  notional: number; // price * quantity in quote currency
  /** exchange event time (UTC epoch ms) */
  eventTime: number;
  /** provider receive time (UTC epoch ms) */
  receivedTime: number;
  /** exchange-native trade id when available (dedup key) */
  tradeId?: string;
  source: string;
}

/** Normalized book-top event. */
export interface BookTopEvent {
  symbol: string;
  bid: number;
  bidQty: number;
  ask: number;
  askQty: number;
  eventTime: number;
  receivedTime: number;
  source: string;
}

/** Normalized kline/candle event. */
export interface KlineEvent {
  symbol: string;
  interval: Interval;
  candle: Candle;
  eventTime: number;
  receivedTime: number;
  source: string;
}

/** Latency probes recorded per stage (§10). */
export interface LatencySample {
  /** exchange → provider receive */
  exchangeToReceiveMs: number | null;
  /** provider receive → engine processed */
  receiveToProcessMs: number | null;
  /** engine processed → frontend render */
  processToRenderMs: number | null;
  /** exchange event → chart paint (end-to-end) */
  totalMs: number | null;
  at: number;
}

export type FeedHealth = "connecting" | "connected" | "reconnecting" | "stale" | "error";

export interface Diagnostics {
  exchange: string;
  connection: FeedHealth;
  streamHealth: FeedHealth;
  lastEventTime: number | null; // exchange event time
  lastReceiveTime: number | null; // local receive
  lastRenderTime: number | null; // chart paint
  latency: LatencySample | null;
  reconnects: number;
  dataGapsDetected: number;
  invalidMessages: number;
  lastHeartbeat: number | null;
  activeProvider: string | null;
}

/** Message pushed to the React layer / UI. */
export type EngineEvent =
  | { type: "candle_update"; key: CandleKey; candle: Candle; closed: boolean; isBackfill: boolean }
  | { type: "candles_loaded"; key: CandleKey; candles: Candle[]; source: "rest" | "backfill" }
  | { type: "tick"; symbol: string; price: number; eventTime: number; receiveTime: number }
  | { type: "book_top"; event: BookTopEvent }
  | { type: "health"; diagnostics: Diagnostics }
  | { type: "gap_detected"; key: CandleKey; missing: number };

// ------------------------------------------------------------
// Provider interface (§27) — implement one per exchange.
// ------------------------------------------------------------

export interface SubscriptionRequest {
  symbol: string;
  interval: Interval;
}

export interface HistoricalCandlesResult {
  key: CandleKey;
  candles: Candle[];
  /** exchange server time when the snapshot was taken (ms) */
  serverTime: number;
}

export interface MarketDataProvider {
  readonly name: string;
  connect(): void;
  disconnect(): void;
  subscribeSymbols(symbols: string[], intervals: Interval[]): void;
  unsubscribeSymbols(symbols: string[], intervals: Interval[]): void;
  /** REST historical klines, UTC-normalized, ascending, validated. */
  getHistoricalCandles(symbol: string, interval: Interval, limit: number): Promise<HistoricalCandlesResult>;
  getLatestPrice(symbol: string): number | null;
  /** Exchange server clock offset estimator (ms). +N means server ahead of local clock. */
  getServerTimeOffsetMs(): number | null;
  readonly diagnostics: Diagnostics;

  // callbacks wired by the engine
  onKline?: (ev: KlineEvent) => void;
  onTick?: (ev: TickEvent) => void;
  onBookTop?: (ev: BookTopEvent) => void;
  onHealth?: (health: FeedHealth, detail?: string) => void;
  /** Fired when the provider just reconnected and gives the last event time before drop. */
  onReconnect?: (lastEventTimeBeforeDrop: number | null) => void;
}

// ------------------------------------------------------------
// Validation (§23)
// ------------------------------------------------------------

export function isValidCandle(c: unknown): c is Candle {
  if (!c || typeof c !== "object") return false;
  const x = c as Record<string, unknown>;
  return (
    Number.isFinite(x.time) && (x.time as number) > 0 &&
    Number.isFinite(x.open) && (x.open as number) > 0 &&
    Number.isFinite(x.high) && (x.high as number) > 0 &&
    Number.isFinite(x.low) && (x.low as number) > 0 &&
    Number.isFinite(x.close) && (x.close as number) > 0 &&
    Number.isFinite(x.volume) && (x.volume as number) >= 0 &&
    typeof x.closed === "boolean" &&
    (x.high as number) >= (x.low as number) &&
    (x.high as number) >= Math.max(x.open as number, x.close as number) &&
    (x.low as number) <= Math.min(x.open as number, x.close as number)
  );
}

export function isValidPrice(p: unknown): p is number {
  return typeof p === "number" && Number.isFinite(p) && p > 0;
}

/** Align a timestamp to an interval boundary (floor). */
export function alignTime(t: number, interval: Interval): number {
  return Math.floor(t / INTERVAL_MS[interval]) * INTERVAL_MS[interval];
}
