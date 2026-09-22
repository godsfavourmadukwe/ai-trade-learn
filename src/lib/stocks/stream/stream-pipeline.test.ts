// ============================================================
// STOCK STREAM — Pipeline regression tests
//
// These pin the exact failures that made the live pipeline
// appear dead:
//   1. decoder used the Node-only `Buffer` global → every
//      browser message threw before reaching state
//   2. candle snapshots returned the same array reference →
//      React bailed out and the chart never redrew
//   3. no honest status derivation across the two tick sources
// ============================================================

import { describe, it, expect } from "vitest";
import { parseStreamerMessage, base64ToBytes } from "./protobuf";
import { CandleAggregator, bucketStart } from "./candles";
import { applyLiveQuote } from "./quote-merge";
import { combineStreamHealth, type StockStreamRow } from "./health";
import type { StreamHealth } from "./engine";
import { getMarketStatus } from "./market-hours";
import type { StockQuote } from "@/lib/stocks/data-engine";

// ── Test frame encoder (Node-side helpers only; production
//    code paths under test use NO Buffer at all) ────────────

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
      parts.push((field << 3) | 0);
      pushVarint(zigzag(value));
    } else {
      parts.push((field << 3) | 5);
      const buf = Buffer.alloc(4);
      buf.writeFloatLE(value);
      parts.push(...buf);
    }
  }
  return new Uint8Array(parts);
}

describe("decoder without Buffer (browser safety)", () => {
  it("parses frames correctly when globalThis.Buffer is unavailable", () => {
    const b64 = Buffer.from(
      encodeFrame({ 1: "AAPL", 2: 337.41, 3: 1_790_003_335_000, 5: "NMS", 7: 1, 9: 20_906_556 }),
    ).toString("base64");

    const saved = (globalThis as { Buffer?: unknown }).Buffer;
    try {
      // Simulate the browser: no Node Buffer global exists.
      (globalThis as { Buffer?: unknown }).Buffer = undefined;
      const ticks = parseStreamerMessage(b64);
      expect(ticks.length).toBe(1);
      expect(ticks[0].id).toBe("AAPL");
      expect(ticks[0].price).toBeCloseTo(337.41, 2);
      expect(ticks[0].time).toBe(1_790_003_335_000);
      expect(ticks[0].exchange).toBe("NMS");
      expect(ticks[0].dayVolume).toBe(20_906_556);
    } finally {
      (globalThis as { Buffer?: unknown }).Buffer = saved;
    }
  });

  it("base64ToBytes decodes standard and rejects garbage", () => {
    const bytes = base64ToBytes(Buffer.from("hello").toString("base64"));
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes!)).toBe("hello");
    expect(base64ToBytes("!!!not-base64!!!")).toBeNull();
    expect(base64ToBytes("")).toEqual(new Uint8Array(0));
  });
});

// ── Chart re-render guarantee ─────────────────────────────

describe("candle snapshots drive re-render", () => {
  it("getCandles returns a NEW array reference on every call", () => {
    const agg = new CandleAggregator(10);
    const t0 = bucketStart(1_790_003_335_000, "1m");
    agg.applyTick("AAPL", 100, t0 + 1_000);

    const a = agg.getCandles("AAPL", "1m");
    const b = agg.getCandles("AAPL", "1m");
    expect(a).not.toBe(b); // same reference here would make React bail out
    expect(a).toEqual(b);

    // A new provider tick mutates the buffer; the NEXT snapshot is a new
    // reference carrying the new close → effect fires → canvas redraws.
    agg.applyTick("AAPL", 105, t0 + 2_000);
    const c = agg.getCandles("AAPL", "1m");
    expect(c).not.toBe(b);
    expect(c[0].close).toBe(105);
    expect(b[0].close).toBe(105); // shallow copy shares candle objects (fine — redraw happens on ref change)
  });

  it("new timeframe bucket creates a new candle (no duplicates)", () => {
    const agg = new CandleAggregator(10);
    const t0 = bucketStart(1_790_003_335_000, "1m");
    agg.applyTick("AAPL", 100, t0 + 59_000);
    agg.applyTick("AAPL", 101, t0 + 61_000); // crosses the minute boundary
    const view = agg.getCandles("AAPL", "1m");
    expect(view.length).toBe(2);
    expect(view[1].open).toBe(101);
  });
});

describe("cumulative volume ticks", () => {
  it("duplicate delivery of the same tick adds no volume (dual-path safe)", () => {
    const agg = new CandleAggregator(10);
    const t0 = bucketStart(1_790_003_335_000, "1m");
    agg.applyCumulativeTick("AAPL", 100, t0 + 1_000, 1_000_000);
    agg.applyCumulativeTick("AAPL", 100, t0 + 1_000, 1_000_000); // same tick, second path
    const c = agg.getCandles("AAPL", "1m")[0];
    expect(c.volume).toBe(0); // first observation has unknown prior → delta 0

    agg.applyCumulativeTick("AAPL", 101, t0 + 2_000, 1_000_500);
    expect(agg.getCandles("AAPL", "1m")[0].volume).toBe(500);
  });
});

// ── Quote merge ───────────────────────────────────────────

function restQuote(over: Partial<StockQuote> = {}): StockQuote {
  return {
    symbol: "AAPL",
    name: "Apple Inc.",
    price: 336.13,
    change: 0,
    changePercent: 0,
    high24h: 337,
    low24h: 335,
    open24h: 335.5,
    previousClose: 336.13,
    volume: 20_000_000,
    avgVolume30d: 50_000_000,
    marketCap: 3_000_000_000_000,
    peRatio: 33,
    eps: 10,
    week52High: 360,
    week52Low: 240,
    dividendYield: 0.4,
    beta: 1.2,
    sector: "Technology",
    industry: "Consumer Electronics",
    currency: "USD",
    exchange: "NMS",
    lastUpdate: 1_790_003_000_000,
    dataStatus: "live",
    ...over,
  };
}

describe("applyLiveQuote", () => {
  it("returns null when there is no REST-seeded quote yet", () => {
    expect(
      applyLiveQuote(null, { symbol: "AAPL", price: 100, time: Date.now() }),
    ).toBeNull();
  });

  it("ignores ticks for a different symbol (no cross-symbol bleed)", () => {
    const prev = restQuote();
    const next = applyLiveQuote(prev, { symbol: "MSFT", price: 500, time: Date.now() });
    expect(next).toBe(prev); // same reference → no re-render
  });

  it("ignores invalid prices instead of fabricating state", () => {
    const prev = restQuote();
    expect(applyLiveQuote(prev, { symbol: "AAPL", price: NaN, time: Date.now() })).toBe(prev);
    expect(applyLiveQuote(prev, { symbol: "AAPL", price: -1, time: Date.now() })).toBe(prev);
    expect(applyLiveQuote(prev, { symbol: "AAPL", price: 0, time: Date.now() })).toBe(prev);
  });

  it("merges provider fields and keeps REST values for missing ones", () => {
    const prev = restQuote();
    const next = applyLiveQuote(prev, {
      symbol: "AAPL",
      price: 337.41,
      time: 1_790_003_335_000,
      change: 1.28,
      changePercent: 0.38,
      dayHigh: 338,
      dayLow: 334.5,
      dayVolume: 20_906_556,
      bid: 337.4,
      ask: 337.5,
      feedDelayMs: 300,
    });
    expect(next).not.toBe(prev);
    expect(next!.price).toBe(337.41);
    expect(next!.change).toBe(1.28);
    expect(next!.high24h).toBe(338);
    expect(next!.low24h).toBe(334.5);
    expect(next!.volume).toBe(20_906_556);
    expect(next!.bid).toBe(337.4);
    expect(next!.ask).toBe(337.5);
    expect(next!.marketCap).toBe(prev.marketCap); // untouched REST field
    expect(next!.dataStatus).toBe("live");
  });

  it("marks data delayed when provider timestamps lag", () => {
    const next = applyLiveQuote(restQuote(), {
      symbol: "AAPL",
      price: 337,
      time: Date.now() - 15 * 60_000,
      feedDelayMs: 15 * 60_000,
    });
    expect(next!.dataStatus).toBe("delayed");
  });
});

// ── Combined health / watchdog status ─────────────────────

// Monday 2026-09-21 14:00 UTC = 10:00 ET → regular session open
const NOW_OPEN = Date.UTC(2026, 8, 21, 14, 0, 10);
const SATURDAY = Date.UTC(2026, 8, 19, 15, 0, 0);

function clientHealth(over: Partial<StreamHealth> = {}, now = NOW_OPEN): StreamHealth {
  return {
    status: "live",
    subscribedSymbol: "AAPL",
    lastTickAt: now - 1_000,
    dataAgeMs: 1_000,
    reconnectCount: 1,
    errors: 0,
    lastError: null,
    marketStatus: getMarketStatus(now, "NMS"),
    wsConnected: true,
    provider: "yahoo-streamer",
    messagesReceived: 42,
    providerTime: now - 1_000,
    feedDelayMs: 200,
    ...over,
  };
}

function backendRow(over: Partial<StockStreamRow> = {}, now = NOW_OPEN): StockStreamRow {
  return {
    symbol: "AAPL",
    provider: "yahoo-streamer",
    status: "live",
    desired: true,
    desiredAt: now - 30_000,
    heartbeatAt: now - 1_000,
    price: 337.41,
    providerTime: now - 1_000,
    receivedAt: now - 1_000,
    feedDelayMs: 250,
    messagesReceived: 120,
    ticksWritten: 60,
    reconnectCount: 2,
    exchange: "NMS",
    updatedAt: now - 1_000,
    ...over,
  } as StockStreamRow;
}

describe("combineStreamHealth", () => {
  it("shows LIVE when fresh provider data arrives on an open market", () => {
    const h = combineStreamHealth(clientHealth(), backendRow(), "AAPL", NOW_OPEN);
    expect(h.status).toBe("live");
    expect(h.messagesReceived).toBe(42 + 120); // both paths counted
    expect(h.reconnectCount).toBe(3);
    expect(h.lastTickAt).toBe(NOW_OPEN - 1_000);
  });

  it("shows LIVE from the BACKEND path alone (server → frontend works independently)", () => {
    const h = combineStreamHealth(null, backendRow(), "aapl", NOW_OPEN);
    expect(h.status).toBe("live");
    expect(h.wsConnected).toBe(true); // backend heartbeat keeps transport "up"
    expect(h.subscribedSymbol).toBe("AAPL"); // normalized
  });

  it("shows STALE when data stops arriving while transports look up", () => {
    const row = backendRow({ receivedAt: NOW_OPEN - 40_000, providerTime: NOW_OPEN - 40_000, feedDelayMs: 0 });
    const h = combineStreamHealth(
      clientHealth({ lastTickAt: NOW_OPEN - 40_000, providerTime: NOW_OPEN - 40_000 }),
      row,
      "AAPL",
      NOW_OPEN,
    );
    expect(h.status).toBe("stale");
  });

  it("shows RECONNECTING when both transports are down", () => {
    const h = combineStreamHealth(
      clientHealth({ wsConnected: false, lastTickAt: NOW_OPEN - 10_000 }),
      backendRow({
        desired: false,
        status: "stopped",
        heartbeatAt: NOW_OPEN - 60_000,
        receivedAt: NOW_OPEN - 10_000, // no server writes since the drop either
        providerTime: NOW_OPEN - 10_000,
      }),
      "AAPL",
      NOW_OPEN,
    );
    expect(h.status).toBe("reconnecting");
    expect(h.wsConnected).toBe(false);
  });

  it("shows DELAYED when provider timestamps lag (never claims LIVE)", () => {
    const lag = 15 * 60_000;
    const h = combineStreamHealth(
      clientHealth({ feedDelayMs: lag, providerTime: NOW_OPEN - lag, lastTickAt: NOW_OPEN - 500 }),
      backendRow({ feedDelayMs: lag, providerTime: NOW_OPEN - lag, receivedAt: NOW_OPEN - 500 }),
      "AAPL",
      NOW_OPEN,
    );
    expect(h.status).toBe("delayed");
  });

  it("shows MARKET CLOSED on a closed market even with old data (not STALE)", () => {
    const h = combineStreamHealth(
      clientHealth({ marketStatus: getMarketStatus(SATURDAY, "NMS"), lastTickAt: SATURDAY - 40_000 }),
      backendRow(),
      "AAPL",
      SATURDAY,
    );
    expect(h.status).toBe("market-closed");
  });

  it("shows CONNECTING before any tick has ever arrived", () => {
    const h = combineStreamHealth(
      clientHealth({ lastTickAt: 0, status: "connecting", wsConnected: true }),
      null,
      "AAPL",
      NOW_OPEN,
    );
    expect(h.status).toBe("connecting");
    expect(h.dataAgeMs).toBe(-1);
  });

  it("ignores a backend row belonging to a different symbol", () => {
    const h = combineStreamHealth(
      clientHealth({ lastTickAt: 0, status: "connecting" }),
      backendRow({ symbol: "MSFT" }),
      "AAPL",
      NOW_OPEN,
    );
    expect(h.lastTickAt).toBe(0); // MSFT row must not make AAPL look live
    expect(h.status).toBe("connecting");
  });

  it("full watchdog cycle: LIVE → STALE → RECONNECTING → LIVE", () => {
    // 1. live
    expect(combineStreamHealth(clientHealth(), backendRow(), "AAPL", NOW_OPEN).status).toBe("live");

    // 2. silence for 40s while sockets claim to be up
    const t2 = NOW_OPEN + 40_000;
    const silent = clientHealth({ lastTickAt: NOW_OPEN, providerTime: NOW_OPEN, feedDelayMs: 0 }, t2);
    expect(
      combineStreamHealth(silent, backendRow({ receivedAt: NOW_OPEN, providerTime: NOW_OPEN, heartbeatAt: t2 - 1_000 }), "AAPL", t2)
        .status,
    ).toBe("stale");

    // 3. transports drop
    const t3 = NOW_OPEN + 50_000;
    const down = clientHealth({ lastTickAt: NOW_OPEN, wsConnected: false }, t3);
    expect(
      combineStreamHealth(
        down,
        backendRow({ receivedAt: NOW_OPEN, desired: false, status: "stopped", heartbeatAt: NOW_OPEN + 10_000 }),
        "AAPL",
        t3,
      ).status,
    ).toBe("reconnecting");

    // 4. recovery: fresh tick again
    const t4 = NOW_OPEN + 60_000;
    expect(
      combineStreamHealth(
        clientHealth({ lastTickAt: t4 - 500, providerTime: t4 - 500, feedDelayMs: 100 }, t4),
        backendRow({ receivedAt: t4 - 500, providerTime: t4 - 500, heartbeatAt: t4 - 500, feedDelayMs: 100 }, t4),
        "AAPL",
        t4,
      ).status,
    ).toBe("live");
  });
});
