import { v } from "convex/values";
import { query, action, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// ── Constants ──────────────────────────────────────────────

const EXCHANGE_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
];

const INTERVAL_MAP: Record<string, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d",
};

const BINANCE_REST = "https://api.binance.com";

// ── Mutations (internal) ───────────────────────────────────

export const upsertTicker = internalMutation({
  args: {
    symbol: v.string(),
    price: v.number(),
    change24hPercent: v.number(),
    high24h: v.number(),
    low24h: v.number(),
    volume24h: v.number(),
    open24h: v.number(),
    lastUpdate: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("liveTickers")
      .withIndex("by_symbol", (q) => q.eq("symbol", args.symbol))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("liveTickers", args);
    }
  },
});

export const upsertCandle = internalMutation({
  args: {
    symbol: v.string(),
    interval: v.string(),
    time: v.number(),
    open: v.number(),
    high: v.number(),
    low: v.number(),
    close: v.number(),
    volume: v.number(),
    closed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("liveCandles")
      .withIndex("by_symbol_interval", (q) =>
        q.eq("symbol", args.symbol).eq("interval", args.interval).eq("time", args.time)
      )
      .first();
    if (existing) {
      if (args.closed || !existing.closed || args.high > existing.high || args.low < existing.low || args.volume > existing.volume) {
        await ctx.db.patch(existing._id, {
          open: args.open,
          high: args.high,
          low: args.low,
          close: args.close,
          volume: args.volume,
          closed: args.closed,
        });
      }
    } else {
      await ctx.db.insert("liveCandles", args);
    }
  },
});

// ── Actions (server-side) ──────────────────────────────────

/** Fetch all 24h tickers from Binance — FAST, ~1 second. */
export const fetchTickers = internalAction({
  handler: async (ctx) => {
    try {
      const res = await fetch(`${BINANCE_REST}/api/v3/ticker/24hr`);
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      const tickers = (await res.json()) as Array<{
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
        highPrice: string;
        lowPrice: string;
        quoteVolume: string;
        openPrice: string;
      }>;

      let updated = 0;
      for (const t of tickers) {
        if (!EXCHANGE_SYMBOLS.includes(t.symbol)) continue;
        const price = parseFloat(t.lastPrice);
        if (!Number.isFinite(price) || price <= 0) continue;

        await ctx.runMutation(internal.marketProxy.upsertTicker, {
          symbol: t.symbol,
          price,
          change24hPercent: parseFloat(t.priceChangePercent) || 0,
          high24h: parseFloat(t.highPrice) || price,
          low24h: parseFloat(t.lowPrice) || price,
          volume24h: parseFloat(t.quoteVolume) || 0,
          open24h: parseFloat(t.openPrice) || price,
          lastUpdate: Date.now(),
        });
        updated++;
      }
      return { ok: true, updated };
    } catch (e) {
      console.error("[marketProxy] fetchTickers failed:", e);
      return { ok: false, error: String(e) };
    }
  },
});

/** Fetch candles for ONE symbol+interval. */
export const fetchCandles = internalAction({
  args: {
    symbol: v.string(),
    interval: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const interval = INTERVAL_MAP[args.interval] ?? args.interval;
    try {
      const res = await fetch(
        `${BINANCE_REST}/api/v3/klines?symbol=${args.symbol}&interval=${interval}&limit=${limit}`
      );
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      const rows = (await res.json()) as unknown[][];
      if (!Array.isArray(rows)) throw new Error("Unexpected payload");

      let inserted = 0;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 6) continue;
        const time = Number(row[0]);
        const open = Number(row[1]);
        const high = Number(row[2]);
        const low = Number(row[3]);
        const close = Number(row[4]);
        const volume = Number(row[5]);

        if (!Number.isFinite(time) || time <= 0) continue;
        if (!Number.isFinite(open) || open <= 0) continue;
        if (!Number.isFinite(close) || close <= 0) continue;
        if (high < low) continue;

        await ctx.runMutation(internal.marketProxy.upsertCandle, {
          symbol: args.symbol,
          interval,
          time, open, high, low, close, volume,
          closed: true,
        });
        inserted++;
      }
      return { ok: true, inserted };
    } catch (e) {
      console.error(`[marketProxy] fetchCandles ${args.symbol} ${interval} failed:`, e);
      return { ok: false, error: String(e) };
    }
  },
});

// ── Public actions (called from frontend via useAction) ─────

/**
 * Start polling — ONLY fetches tickers (fast, ~2s).
 * Schedules separate actions for candle fetching and future polls.
 */
export const startPolling = action({
  args: {},
  handler: async (ctx) => {
    // 1. Fetch tickers immediately (fast — one HTTP request + 10 mutations)
    await ctx.runAction(internal.marketProxy.fetchTickers);

    // 2. Schedule candle fetches one symbol at a time (avoids timeout)
    for (let i = 0; i < EXCHANGE_SYMBOLS.length; i++) {
      await ctx.scheduler.runAfter(
        i * 2000, // stagger by 2s each to avoid rate limits
        internal.marketProxy.pollCandlesForSymbol,
        { symbol: EXCHANGE_SYMBOLS[i], interval: "1m" },
      );
    }

    // 3. Schedule recurring ticker poll every 5s
    await ctx.scheduler.runAfter(5000, internal.marketProxy.pollTickers);

    // 4. Schedule recurring candle poll every 30s (one symbol per cycle)
    await ctx.scheduler.runAfter(30000, internal.marketProxy.pollNextCandle);

    return { ok: true };
  },
});

/** Self-perpetuating ticker poll (every 5s). */
export const pollTickers = internalAction({
  handler: async (ctx) => {
    await ctx.runAction(internal.marketProxy.fetchTickers);
    await ctx.scheduler.runAfter(5000, internal.marketProxy.pollTickers);
  },
});

/** Fetch candles for ONE symbol. Self-schedules next symbol. */
export const pollCandlesForSymbol = internalAction({
  args: {
    symbol: v.string(),
    interval: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runAction(internal.marketProxy.fetchCandles, {
      symbol: args.symbol,
      interval: args.interval,
      limit: 100,
    });
  },
});

/** Rotate through symbols for candle updates. */
let candlePollIndex = 0;
export const pollNextCandle = internalAction({
  handler: async (ctx) => {
    const symbol = EXCHANGE_SYMBOLS[candlePollIndex % EXCHANGE_SYMBOLS.length];
    candlePollIndex++;
    await ctx.runAction(internal.marketProxy.fetchCandles, {
      symbol,
      interval: "1m",
      limit: 100,
    });
    await ctx.scheduler.runAfter(30000, internal.marketProxy.pollNextCandle);
  },
});

// ── Queries (real-time subscriptions) ──────────────────────

export const getTickers = query({
  handler: async (ctx) => {
    return await ctx.db.query("liveTickers").collect();
  },
});

export const getTicker = query({
  args: { symbol: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("liveTickers")
      .withIndex("by_symbol", (q) => q.eq("symbol", args.symbol))
      .first();
  },
});

export const getCandles = query({
  args: { symbol: v.string(), interval: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("liveCandles")
      .withIndex("by_symbol_interval", (q) =>
        q.eq("symbol", args.symbol).eq("interval", args.interval)
      )
      .collect();
    rows.sort((a, b) => a.time - b.time);
    return rows;
  },
});

export const getHealth = query({
  handler: async (ctx) => {
    const tickers = await ctx.db.query("liveTickers").collect();
    const latestUpdate = tickers.reduce((max, t) => Math.max(max, t.lastUpdate), 0);
    return {
      tickerCount: tickers.length,
      latestUpdate,
      ageMs: Date.now() - latestUpdate,
      healthy: tickers.length > 0 && Date.now() - latestUpdate < 30_000,
    };
  },
});
