// ============================================================
// STOCK STREAM — Unit tests (no network)
// ============================================================

import { describe, it, expect } from "vitest";
import { decodePricingData, parseStreamerMessage } from "./protobuf";
import { CandleAggregator, bucketStart, STREAM_INTERVAL_MS } from "./candles";
import { getMarketStatus } from "./market-hours";
import type { Candle } from "@/lib/market/types";

// ── Protobuf decoder ───────────────────────────────────────

function encodeFrame(fields: Record<number, number | string>): Uint8Array {
  const parts: number[] = [];
  const pushVarint = (n: bigint) => {
    let v = n;
    do {
      let b = Number(v & 0x7fn);
      v >>= 7n;
      if (v > 0n) b |= 0x80;
      parts.push(b);
    } while (v > 0n);
  };
  const zigzag = (n: number) => (BigInt(n) << 1n) ^ (BigInt(n) >> 63n);

  for (const [key, value] of Object.entries(fields)) {
    const field = Number(key);
    if (typeof value === "string") {
      parts.push((field << 3) | 2);
      const bytes = Array.from(new TextEncoder().encode(value));
      pushVarint(BigInt(bytes.length));
      parts.push(...bytes);
    } else if (field === 3) {
      parts.push((field << 3) | 0); // varint
      pushVarint(zigzag(value));
    } else {
      parts.push((field << 3) | 5); // fixed32
      const buf = Buffer.alloc(4);
      buf.writeFloatLE(value);
      parts.push(...buf);
    }
  }
  return new Uint8Array(parts);
}

describe("protobuf decoder", () => {
  it("decodes a realistic AAPL PricingData frame", () => {
    // Mirrors the live frame: f1 id, f2 price, f3 time(zigzag), f5 exchange,
    // f7 marketHours, f8 changePercent, f9 dayVolume, f12 change
    const bytes = encodeFrame({
      1: "AAPL",
      2: 337.41,
      3: 1790003335000, // zigzag-encoded inside encoder
      5: "NMS",
      7: 1,
      8: 0.38,
      9: 20906556,
      12: 1.28,
    });
    const t = parseStreamerMessage(Buffer.from(bytes).toString("base64"))[0];
    expect(t).toBeDefined();
    expect(t!.id).toBe("AAPL");
    expect(t!.price).toBeCloseTo(337.41, 2);
    expect(t!.time).toBe(1790003335000);
    expect(t!.exchange).toBe("NMS");
    expect(t!.marketHours).toBe(1);
    expect(t!.changePercent).toBeCloseTo(0.38, 5);
    expect(t!.dayVolume).toBe(20906556);
    expect(t!.change).toBeCloseTo(1.28, 5);
  });

  it("parses JSON-array streamer messages", () => {
    const bytes = encodeFrame({ 1: "MSFT", 2: 493.68, 3: 1790003335000 });
    const b64 = Buffer.from(bytes).toString("base64");
    const ticks = parseStreamerMessage(JSON.stringify([b64, "!!!not-base64!!!"]));
    expect(ticks.length).toBe(1);
    expect(ticks[0].id).toBe("MSFT");
  });

  it("rejects frames without id+price instead of fabricating", () => {
    expect(parseStreamerMessage("AAAA")).toEqual([]);
    expect(parseStreamerMessage("not a frame at all")).toEqual([]);
    expect(parseStreamerMessage("")).toEqual([]);
  });

  it("decodes bid/ask fields when present", () => {
    const bytes = encodeFrame({ 1: "TSLA", 2: 375.45, 3: 1790003335000, 23: 375.4, 25: 375.5, 24: 12, 26: 9 });
    const d = decodePricingData(bytes);
    expect(d.bid).toBeCloseTo(375.4, 2);
    expect(d.ask).toBeCloseTo(375.5, 2);
    expect(d.bidSize).toBe(12);
    expect(d.askSize).toBe(9);
  });
});

// ── Candle aggregation ─────────────────────────────────────

const MIN = 60_000;

function candleAt(timeMs: number, price = 100): Candle {
  return {
    time: timeMs,
    open: price,
    high: price * 1.01,
    low: price * 0.99,
    close: price,
    volume: 1000,
    closed: true,
  };
}

describe("candle aggregation", () => {
  it("computes bucket starts correctly", () => {
    expect(bucketStart(1_790_003_335_000, "1m") % STREAM_INTERVAL_MS["1m"]).toBe(0);
    expect(bucketStart(1_790_003_335_000, "1h") % STREAM_INTERVAL_MS["1h"]).toBe(0);
    expect(bucketStart(1_790_003_335_000, "1d") % STREAM_INTERVAL_MS["1d"]).toBe(0);
  });

  it("updates the current candle and never duplicates", () => {
    const agg = new CandleAggregator(400);
    const t0 = bucketStart(1_790_003_335_000, "1m");
    agg.applyTick("AAPL", 100, t0 + 1_000);
    agg.applyTick("AAPL", 102, t0 + 20_000);
    agg.applyTick("AAPL", 99, t0 + 40_000);
    agg.applyTick("AAPL", 101, t0 + 59_000);

    const candles = agg.getCandles("AAPL", "1m");
    expect(candles.length).toBe(1);
    expect(candles[0].open).toBe(100);
    expect(candles[0].high).toBe(102);
    expect(candles[0].low).toBe(99);
    expect(candles[0].close).toBe(101);
  });

  it("opens the next candle when the timeframe expires", () => {
    const agg = new CandleAggregator(400);
    const t0 = bucketStart(1_790_003_335_000, "1m");
    agg.applyTick("AAPL", 100, t0 + 1_000);
    agg.applyTick("AAPL", 105, t0 + MIN + 5_000); // next minute
    const candles = agg.getCandles("AAPL", "1m");
    expect(candles.length).toBe(2);
    expect(candles[0].close).toBe(100);
    expect(candles[1].open).toBe(105);
  });

  it("seeds history without duplicating live candles", () => {
    const agg = new CandleAggregator(400);
    const t0 = bucketStart(1_790_003_335_000, "1m");
    agg.applyTick("AAPL", 100, t0 + 30_000);
    agg.seed("AAPL", "1m", [candleAt(t0, 100)]);
    expect(agg.getCandles("AAPL", "1m").length).toBe(1);
  });

  it("reconciles the live candle from authoritative REST data", () => {
    const agg = new CandleAggregator(400);
    const t0 = bucketStart(1_790_003_335_000, "1m");
    agg.applyTick("AAPL", 100, t0 + 30_000);
    // REST returns the authoritative candle for the same bucket
    agg.seed("AAPL", "1m", [
      { time: t0, open: 99.5, high: 101, low: 99, close: 100.5, volume: 50_000, closed: true },
    ]);
    const c = agg.getCandles("AAPL", "1m")[0];
    expect(c.open).toBe(99.5);
    expect(c.volume).toBe(50_000);
  });

  it("marks elapsed candles closed", () => {
    const agg = new CandleAggregator(400);
    const t0 = bucketStart(1_790_003_335_000, "1m");
    agg.applyTick("AAPL", 100, t0 + 10_000);
    agg.applyTick("AAPL", 101, t0 + MIN + 10_000);
    agg.closeCandlesBefore("AAPL", t0 + MIN + 11_000);
    const candles = agg.getCandles("AAPL", "1m");
    expect(candles[0].closed).toBe(true);
    expect(candles[1].closed).toBe(false);
  });

  it("tracks multiple symbols independently", () => {
    const agg = new CandleAggregator(400);
    const t0 = bucketStart(1_790_003_335_000, "1m");
    agg.applyTick("AAPL", 100, t0 + 1_000);
    agg.applyTick("MSFT", 490, t0 + 2_000);
    expect(agg.getCandles("AAPL", "1m")[0].close).toBe(100);
    expect(agg.getCandles("MSFT", "1m")[0].close).toBe(490);
  });
});

// ── Market hours ───────────────────────────────────────────

describe("market hours", () => {
  // 2026-09-21 is a Monday
  const mon = (h: number, m: number) => Date.UTC(2026, 8, 21, h, m);

  it("marks regular session as LIVE (10:00 ET = 14:00 UTC in September)", () => {
    const s = getMarketStatus(mon(14, 0), "NMS");
    expect(s.isRegularOpen).toBe(true);
    expect(s.label).toBe("LIVE");
  });

  it("marks pre-market and after-hours as open but not regular", () => {
    const pre = getMarketStatus(mon(9, 0), "NMS"); // 05:00 ET
    expect(pre.session).toBe("pre");
    const post = getMarketStatus(mon(21, 0), "NMS"); // 17:00 ET
    expect(post.session).toBe("post");
  });

  it("marks weekend as closed", () => {
    const sat = getMarketStatus(Date.UTC(2026, 8, 19, 15, 0), "NMS");
    expect(sat.session).toBe("closed");
    expect(sat.isOpen).toBe(false);
  });

  it("marks US holidays as closed", () => {
    const laborDay = Date.UTC(2026, 8, 7, 15, 0); // Sep 7 2026, 11:00 ET
    expect(getMarketStatus(laborDay, "NMS").session).toBe("closed");
  });

  it("marks early-close days closed after 13:00 ET", () => {
    const nov27 = Date.UTC(2026, 10, 27, 18, 30); // 13:30 ET
    expect(getMarketStatus(nov27, "NMS").session).toBe("closed");
  });

  it("handles non-US exchanges with the fallback window", () => {
    const s = getMarketStatus(mon(14, 0), "LSE");
    expect(s.isOpen).toBe(true);
    const closed = getMarketStatus(mon(22, 0), "LSE");
    expect(closed.session).toBe("closed");
  });
});
