import { describe, it, expect } from "vitest";
import {
  splitExchangeSymbol,
  exchangeToDisplay,
  normalizeToExchangeSymbol,
  scorePair,
  searchPairs,
  FALLBACK_PAIRS,
  type RegistryPair,
  type TickerRow,
} from "./registry";
import {
  analyzePair,
  evaluateThesis,
  detectRegime,
  type Candle,
} from "./pair-analysis";

const pair = (o: Partial<RegistryPair>): RegistryPair => ({
  exchangeSymbol: "BTCUSDT",
  symbol: "BTC/USDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  exchange: "binance",
  status: "TRADING",
  pricePrecision: 2,
  quantityPrecision: 5,
  ...o,
});

const ticker = (o: Partial<TickerRow>): TickerRow => ({
  symbol: "BTCUSDT",
  price: 67000,
  change24hPercent: 1.5,
  high24h: 68000,
  low24h: 66000,
  quoteVolume24h: 25_000_000_000,
  open24h: 66000,
  fetchedAt: Date.now(),
  ...o,
});

// ── Symbol normalization ──────────────────────────────────────

describe("registry symbol normalization", () => {
  it("splits BTCUSDT → BTC/USDT", () => {
    expect(exchangeToDisplay("BTCUSDT")).toBe("BTC/USDT");
    expect(splitExchangeSymbol("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
  });

  it("splits ETHUSDT → ETH/USDT", () => {
    expect(exchangeToDisplay("ETHUSDT")).toBe("ETH/USDT");
  });

  it("handles multi-char bases and alternate quotes", () => {
    expect(exchangeToDisplay("PEPEUSDT")).toBe("PEPE/USDT");
    expect(exchangeToDisplay("1000SATSUSDT")).toBe("1000SATS/USDT");
    expect(exchangeToDisplay("ETHBTC")).toBe("ETH/BTC");
    expect(exchangeToDisplay("BNBTRY")).toBe("BNB/TRY");
  });

  it("rejects un-splittable symbols", () => {
    expect(exchangeToDisplay("USDT")).toBeNull();
    expect(exchangeToDisplay("XYZ")).toBeNull();
  });

  it("normalizeToExchangeSymbol strips separators and casing", () => {
    expect(normalizeToExchangeSymbol("btc/usdt")).toBe("BTCUSDT");
    expect(normalizeToExchangeSymbol("btc usdt")).toBe("BTCUSDT");
    expect(normalizeToExchangeSymbol("BTCUSDT")).toBe("BTCUSDT");
  });
});

// ── Search scoring ────────────────────────────────────────────

describe("registry search", () => {
  const registry: RegistryPair[] = [
    pair({}),
    pair({ exchangeSymbol: "ETHUSDT", symbol: "ETH/USDT", baseAsset: "ETH" }),
    pair({ exchangeSymbol: "SOLUSDT", symbol: "SOL/USDT", baseAsset: "SOL" }),
    pair({ exchangeSymbol: "BTCEUR", symbol: "BTC/EUR", baseAsset: "BTC", quoteAsset: "EUR" }),
    pair({ exchangeSymbol: "ETHBTC", symbol: "ETH/BTC", baseAsset: "ETH", quoteAsset: "BTC" }),
  ];

  const run = (q: string) =>
    searchPairs(q, registry, null, 50).map((r) => r.pair.exchangeSymbol);

  it("matches exchange format BTCUSDT", () => {
    expect(run("BTCUSDT")[0]).toBe("BTCUSDT");
  });

  it("matches display symbol BTC/USDT (case-insensitive, with slash)", () => {
    expect(run("btc/usdt")[0]).toBe("BTCUSDT");
  });

  it("matches base asset partial BTC", () => {
    const res = run("BTC");
    expect(res).toContain("BTCUSDT");
    expect(res).toContain("BTCEUR");
    expect(res.indexOf("BTCUSDT")).toBeLessThan(res.indexOf("BTCEUR")); // USDT ranked higher
  });

  it("matches coin name Bitcoin", () => {
    expect(run("bitcoin")[0]).toBe("BTCUSDT");
    expect(run("Bitcoin")[0]).toBe("BTCUSDT");
  });

  it("partial name 'bitco' still finds BTC", () => {
    expect(run("bitco")).toContain("BTCUSDT");
  });

  it("returns [] for invalid/no-match pairs", () => {
    expect(run("ZZZZZZ")).toEqual([]);
    expect(run("")).toEqual([]);
  });

  it("empty query returns nothing (not the whole registry)", () => {
    expect(run("   ")).toEqual([]);
  });

  it("quote-only searches rank low but still match", () => {
    const res = run("USDT");
    expect(res.length).toBeGreaterThan(0);
  });

  it("respects the limit parameter", () => {
    const many: RegistryPair[] = Array.from({ length: 30 }, (_, i) =>
      pair({ exchangeSymbol: `COIN${i}USDT`, symbol: `COIN${i}/USDT`, baseAsset: `COIN${i}` }),
    );
    expect(searchPairs("COIN", many, null, 10).length).toBe(10);
  });

  it("attaches ticker rows when index is provided", () => {
    const tickers = new Map([["BTCUSDT", ticker({})]]);
    const res = searchPairs("BTC", registry, tickers, 10);
    const btc = res.find((r) => r.pair.exchangeSymbol === "BTCUSDT");
    expect(btc?.ticker?.price).toBe(67000);
    // A pair with no ticker entry gets null, not a fake value
    const eur = res.find((r) => r.pair.exchangeSymbol === "BTCEUR");
    expect(eur).toBeDefined();
    expect(eur!.ticker).toBeNull();
  });
});

// ── Candle generation helpers ─────────────────────────────────

function genCandles(n: number, startPrice: number, drift: number, noise = 0.001): Candle[] {
  const out: Candle[] = [];
  let price = startPrice;
  const t0 = Date.now() - n * 60_000 - 30_000; // ends ~30s before `now`
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = open * (1 + drift + (i % 7 === 0 ? noise : -noise * 0.5));
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    out.push({ time: t0 + i * 60_000, open, high, low, close, volume: 100 + i, closed: true });
    price = close;
  }
  return out;
}

// ── Pair analysis ─────────────────────────────────────────────

describe("pair analysis", () => {
  const baseInput = (overrides: Partial<Parameters<typeof analyzePair>[0]> = {}) => ({
    symbol: "BTC/USDT",
    exchangeSymbol: "BTCUSDT",
    exchange: "binance",
    candles: genCandles(300, 60000, 0.0005),
    livePrice: null as number | null,
    ticker: { change24hPercent: 1.2, high24h: 68000, low24h: 66000, quoteVolume24h: 1e9 },
    orderBook: null,
    now: Date.now(),
    ...overrides,
  });

  it("produces valid indicators from real candle data", () => {
    const a = analyzePair(baseInput());
    expect(a.dataHealth.ok).toBe(true);
    expect(a.features.samples).toBe(300);
    expect(a.features.ema50).not.toBeNull();
    expect(a.features.ema200).not.toBeNull();
    expect(a.features.rsi14).not.toBeNull();
    expect(a.features.atr14).not.toBeNull();
    expect(a.regime).not.toBe("unknown");
  });

  it("detects an uptrend on rising data", () => {
    const a = analyzePair(baseInput({ candles: genCandles(300, 60000, 0.002) }));
    expect(["uptrend", "strong_uptrend"]).toContain(a.regime);
  });

  it("detects a downtrend on falling data", () => {
    const a = analyzePair(baseInput({ candles: genCandles(300, 60000, -0.002) }));
    expect(["downtrend", "strong_downtrend"]).toContain(a.regime);
  });

  it("flags stale data and refuses analysis", () => {
    const now = Date.now();
    const n = 300;
    const t0 = now - 2 * 60 * 60 * 1000 - n * 60_000; // series ENDS ~2h before `now`
    const candles = genCandles(n, 60000, 0.0005).map((c, i) => ({
      ...c,
      time: t0 + i * 60_000,
    }));
    const a = analyzePair(baseInput({ candles, now }));
    expect(a.dataHealth.ok).toBe(false);
    expect(a.dataHealth.stale).toBe(true);
    expect(a.dataHealth.message).toContain("stale");
  });

  it("refuses to analyze too-few candles", () => {
    const a = analyzePair(baseInput({ candles: genCandles(10, 60000, 0.0005) }));
    expect(a.dataHealth.ok).toBe(false);
  });

  it("rejects invalid candles in feature extraction", () => {
    const candles = genCandles(300, 60000, 0.0005);
    candles[150] = { time: 0, open: 0, high: -1, low: 0, close: 0, volume: -5, closed: true };
    const a = analyzePair(baseInput({ candles }));
    expect(a.features.samples).toBe(299);
  });

  it("uses livePrice over last close when provided", () => {
    const a = analyzePair(baseInput({ livePrice: 71000 }));
    expect(a.features.price).toBe(71000);
  });

  it("computes spread and book imbalance from order book", () => {
    const a = analyzePair(baseInput({ orderBook: { bid: 99.5, ask: 100.5, bidQty: 10, askQty: 5 } }));
    expect(a.features.spreadPct).not.toBeNull();
    expect(a.features.bookImbalance).not.toBeNull();
    expect(a.features.bookImbalance!).toBeGreaterThan(0); // bid-heavy
  });
});

// ── Thesis evaluation ─────────────────────────────────────────

describe("thesis evaluation", () => {
  const bull = analyzePair({
    symbol: "BTC/USDT",
    exchangeSymbol: "BTCUSDT",
    exchange: "binance",
    candles: genCandles(300, 60000, 0.002),
    livePrice: null,
    ticker: { change24hPercent: 3.5, high24h: 70000, low24h: 65000, quoteVolume24h: 1e9 },
    orderBook: null,
    now: Date.now(),
  });
  const bear = analyzePair({
    symbol: "BTC/USDT",
    exchangeSymbol: "BTCUSDT",
    exchange: "binance",
    candles: genCandles(300, 60000, -0.002),
    livePrice: null,
    ticker: { change24hPercent: -3.5, high24h: 70000, low24h: 65000, quoteVolume24h: 1e9 },
    orderBook: null,
    now: Date.now(),
  });

  it("supports a bullish thesis in a genuine uptrend", () => {
    const t = evaluateThesis("BTC is breaking resistance and I expect continuation to the upside", bull);
    expect(t.verdict).toBe("supports");
    expect(t.agreementScore).toBeGreaterThan(60);
    expect(t.supporting.length).toBeGreaterThan(0);
    expect(t.invalidation.length).toBeGreaterThan(0);
  });

  it("contradicts a bullish thesis in a genuine downtrend", () => {
    const t = evaluateThesis("BTC is breaking out, going long", bear);
    expect(t.verdict).toBe("contradicts");
    expect(t.contradicting.length).toBeGreaterThan(0);
    expect(t.agreementScore).toBeLessThan(40);
  });

  it("supports a bearish thesis in a genuine downtrend", () => {
    const t = evaluateThesis("This breakdown will continue lower, I want to short", bear);
    expect(t.verdict).toBe("supports");
  });

  it("contradicts a bearish thesis in a genuine uptrend", () => {
    const t = evaluateThesis("I think we dump from here", bull);
    expect(t.verdict).toBe("contradicts");
  });

  it("handles ambiguous theses without crashing", () => {
    const t = evaluateThesis("Something will happen maybe", bull);
    expect(["mixed", "supports", "contradicts"]).toContain(t.verdict);
    expect(t.conclusion.length).toBeGreaterThan(10);
  });

  it("always derives invalidation levels", () => {
    const t = evaluateThesis("Long", bull);
    expect(t.invalidation.length).toBeGreaterThan(0);
  });
});

// ── Regime detection edge cases ───────────────────────────────

describe("regime detection", () => {
  it("returns unknown for missing data", () => {
    const r = detectRegime({
      price: 0, ema20: null, ema50: null, ema200: null, rsi14: null,
      atr14: null, atrPercent: null, trendSlopePct: null, volumeZ: null,
      volumeVsMa20: null, spreadPct: null, bookImbalance: null,
      change24hPercent: null, high24h: null, low24h: null, quoteVolume24h: null,
      distanceToHigh24hPct: null, distanceToLow24hPct: null, samples: 0,
    });
    expect(r).toBe("unknown");
  });
});

// ── Fallback pairs sanity ─────────────────────────────────────

describe("fallback pairs", () => {
  it("includes the four required pairs with correct formats", () => {
    for (const exch of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]) {
      const p = FALLBACK_PAIRS.find((x) => x.exchangeSymbol === exch);
      expect(p).toBeDefined();
      expect(exchangeToDisplay(exch)).toBe(p!.symbol);
    }
  });
});
