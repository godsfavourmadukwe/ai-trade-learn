// ============================================================
// STOCK STREAM — Live Candle Aggregation Engine
//
// Builds 1m/5m/15m/1h/1d candles from incoming ticks:
//   • update the current candle as ticks arrive
//   • close it when its timeframe expires
//   • open the next candle with the tick that arrived in the
//     new bucket (never fabricating an open price)
//   • never duplicate candles (single current candle per
//     symbol+interval, keyed by bucket start)
// ============================================================

import type { Candle, Interval } from "@/lib/market/types";

export type StreamInterval = "1m" | "5m" | "15m" | "1h" | "1d";

export const STREAM_INTERVALS: StreamInterval[] = ["1m", "5m", "15m", "1h", "1d"];

export const STREAM_INTERVAL_MS: Record<StreamInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};

/** Bucket start (epoch ms) for a tick time under a given interval. */
export function bucketStart(timeMs: number, interval: StreamInterval): number {
  const size = STREAM_INTERVAL_MS[interval];
  return Math.floor(timeMs / size) * size;
}

/** Bounded FIFO buffer of candles per symbol+interval. */
class CandleBuffer {
  private candles: Candle[] = [];
  private byTime = new Map<number, Candle>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get length(): number {
    return this.candles.length;
  }

  getAll(): Candle[] {
    return this.candles;
  }

  has(time: number): boolean {
    return this.byTime.has(time);
  }

  get(time: number): Candle | undefined {
    return this.byTime.get(time);
  }

  append(candle: Candle): void {
    if (this.byTime.has(candle.time)) return; // never duplicate
    this.byTime.set(candle.time, candle);
    this.candles.push(candle);
    while (this.candles.length > this.max) {
      const evicted = this.candles.shift();
      if (evicted) this.byTime.delete(evicted.time);
    }
  }

  /** Replace-or-insert (used by authoritative REST reconciliation). */
  upsert(candle: Candle): void {
    const existing = this.byTime.get(candle.time);
    if (existing) {
      Object.assign(existing, candle);
      return;
    }
    this.append(candle);
  }

  update(time: number, apply: (c: Candle) => void): void {
    const c = this.byTime.get(time);
    if (c) apply(c);
  }

  updateEach(apply: (c: Candle) => void): void {
    for (const c of this.candles) apply(c);
  }
}

/**
 * In-memory candle aggregator for a single symbol across all
 * supported intervals. Feed every tick through `applyTick`.
 */
export class CandleAggregator {
  private buffers = new Map<string, CandleBuffer>();
  private readonly maxPerInterval: number;

  constructor(maxPerInterval = 400) {
    this.maxPerInterval = maxPerInterval;
  }

  private buffer(symbol: string, interval: StreamInterval): CandleBuffer {
    const key = `${symbol}|${interval}`;
    let b = this.buffers.get(key);
    if (!b) {
      b = new CandleBuffer(this.maxPerInterval);
      this.buffers.set(key, b);
    }
    return b;
  }

  /** Seed with historical REST candles (deduped, kept ascending). */
  seed(symbol: string, interval: StreamInterval, candles: Candle[]): void {
    const buf = this.buffer(symbol, interval);
    const sorted = [...candles]
      .filter(
        (c) =>
          Number.isFinite(c.time) && c.time > 0 &&
          Number.isFinite(c.open) && c.open > 0 &&
          Number.isFinite(c.close) && c.close > 0 &&
          Number.isFinite(c.high) && Number.isFinite(c.low) &&
          c.high >= c.low,
      )
      .sort((a, b) => a.time - b.time);
    for (const c of sorted) {
      buf.upsert({
        time: bucketStart(c.time, interval),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        closed: true,
      });
    }
  }

  /** Apply a live tick to every tracked interval. */
  applyTick(symbol: string, price: number, timeMs: number, volumeDelta: number = 0): void {
    if (!Number.isFinite(price) || price <= 0) return;
    if (!Number.isFinite(timeMs) || timeMs <= 0) return;
    for (const interval of STREAM_INTERVALS) {
      const start = bucketStart(timeMs, interval);
      const buf = this.buffer(symbol, interval);
      const existing = buf.get(start);
      if (existing) {
        buf.update(start, (c) => {
          c.high = Math.max(c.high, price);
          c.low = Math.min(c.low, price);
          c.close = price;
          c.volume += volumeDelta;
          c.closed = false;
        });
      } else {
        buf.append({
          time: start,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: volumeDelta,
          closed: false,
        });
      }
    }
  }

  /** Mark every candle whose bucket has fully elapsed as closed. */
  closeCandlesBefore(symbol: string, beforeMs: number): void {
    for (const interval of STREAM_INTERVALS) {
      const buf = this.buffer(symbol, interval);
      buf.updateEach((c) => {
        if (c.time + STREAM_INTERVAL_MS[interval] <= beforeMs) c.closed = true;
      });
    }
  }

  getCandles(symbol: string, interval: StreamInterval): Candle[] {
    return this.buffer(symbol, interval).getAll();
  }
}
