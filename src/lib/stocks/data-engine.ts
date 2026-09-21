// ============================================================
// STOCK MARKET INTELLIGENCE — Stock Data Engine
//
// Professional stock data engine using Yahoo Finance via the
// project's Convex server-side proxy (src/convex/stockProxy.ts).
//
// Why server-side: Yahoo Finance does not set CORS headers, so
// browser fetch() cannot reach it directly — this was the root
// cause of "Could not fetch data". Server-side actions have no
// such restriction and also handle Yahoo's cookie/crumb auth.
//
// Provides: live quotes, historical OHLCV, search, fundamentals.
// NEVER fabricates data — reports failures clearly.
//
// Data flow:
//   Browser → Convex action → Yahoo Finance API → normalized → UI
// ============================================================

import type { Interval, Candle } from "@/lib/market/types";
import { api } from "@/convex/_generated/api";
import { convexHttpClient } from "@/lib/convex-client";

// ── Convex transport ──────────────────────────────────────
//
// A shared browser HTTP client (src/lib/convex-client.ts) is used
// so the whole app keeps one Convex connection per tab.

// ── Types ─────────────────────────────────────────────────

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  open24h: number;
  previousClose: number;
  volume: number;
  avgVolume30d: number;
  marketCap: number;
  peRatio: number | null;
  eps: number | null;
  week52High: number;
  week52Low: number;
  dividendYield: number | null;
  beta: number | null;
  sector: string;
  industry: string;
  currency: string;
  exchange: string;
  lastUpdate: number;
  dataStatus: "live" | "delayed" | "unavailable";
  /** Live bid/ask when the stream provides them (null otherwise). */
  bid?: number | null;
  ask?: number | null;
}

export interface StockSearchResult {
  symbol: string;
  name: string;
  type: "equity" | "etf" | "index" | "mutual_fund" | "other";
  exchange: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
}

export interface FundamentalData {
  symbol: string;
  marketCap: number;
  enterpriseValue: number;
  trailingPE: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  evToRevenue: number | null;
  evToEBITDA: number | null;
  profitMargin: number | null;
  operatingMargin: number | null;
  grossMargin: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  payoutRatio: number | null;
  beta: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  revenuePerShare: number | null;
  lastFiscalYearEnd: number | null;
  nextEarningsDate: number | null;
  dataStatus: "available" | "partial" | "unavailable";
}

/** Corporate actions (splits/dividends) when Yahoo includes them for the range. */
export interface CorporateActions {
  splits: Array<{ date: number; split: string }>;
  dividends: Array<{ date: number; amount: number }>;
}

// ── Diagnostics ───────────────────────────────────────────

export interface DataDiagnostics {
  lastAttempt: number;
  lastSuccess: number;
  lastError: string | null;
  totalRequests: number;
  totalErrors: number;
  consecutiveErrors: number;
  proxyUsed: string;
  avgLatencyMs: number;
}

const diagnostics: DataDiagnostics = {
  lastAttempt: 0,
  lastSuccess: 0,
  lastError: null,
  totalRequests: 0,
  totalErrors: 0,
  consecutiveErrors: 0,
  proxyUsed: "convex:stockProxy",
  avgLatencyMs: 0,
};

export function getDiagnostics(): DataDiagnostics {
  return { ...diagnostics };
}

function recordSuccess(latencyMs: number): void {
  diagnostics.lastSuccess = Date.now();
  diagnostics.consecutiveErrors = 0;
  diagnostics.avgLatencyMs =
    diagnostics.avgLatencyMs > 0 ? (diagnostics.avgLatencyMs + latencyMs) / 2 : latencyMs;
}

function recordError(error: string): void {
  diagnostics.lastError = error;
  diagnostics.totalErrors++;
  diagnostics.consecutiveErrors++;
}

// ── Rate limiting ─────────────────────────────────────────

const requestTimestamps: number[] = [];
const MAX_REQUESTS_PER_SECOND = 3;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - 1000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_REQUESTS_PER_SECOND) {
    const waitMs = requestTimestamps[0] + 1000 - now;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, waitMs)));
  }
  requestTimestamps.push(Date.now());
}

/** Call a Convex proxy action with in-flight dedup + diagnostics. */
const inFlight = new Map<string, Promise<unknown>>();

async function callProxy<T>(
  actionName: "fetchChart" | "searchSymbols" | "getQuoteSummary",
  args: Record<string, unknown>,
  dedupKey: string,
): Promise<T | null> {
  await rateLimit();

  const existing = inFlight.get(dedupKey);
  if (existing) return (await existing) as T | null;

  diagnostics.lastAttempt = Date.now();
  diagnostics.totalRequests++;
  const start = Date.now();

  const promise = (async () => {
    try {
      const fn = api.stockProxy[actionName] as never;
      const result = (await convexHttpClient.action(fn, args as never)) as {
        ok: boolean;
        error?: string;
      } & Record<string, unknown>;

      recordSuccess(Date.now() - start);
      if (!result.ok) {
        recordError(result.error ?? "proxy returned not-ok");
        console.warn(`[StockDataEngine] ${actionName} failed: ${result.error}`);
        return null;
      }
      return result as T;
    } catch (err) {
      recordError(err instanceof Error ? err.message : String(err));
      console.warn(`[StockDataEngine] ${actionName} threw:`, err);
      return null;
    } finally {
      inFlight.delete(dedupKey);
    }
  })();

  inFlight.set(dedupKey, promise);
  return (await promise) as T | null;
}

// ── Interval Mapping ──────────────────────────────────────

function intervalRangeMap(interval: Interval): { range: string; interval: string } {
  const map: Record<Interval, { range: string; interval: string }> = {
    "1m": { range: "1d", interval: "1m" },
    "5m": { range: "5d", interval: "5m" },
    "15m": { range: "5d", interval: "15m" },
    "1h": { range: "1mo", interval: "1h" },
    "4h": { range: "3mo", interval: "1d" },
    "1d": { range: "1y", interval: "1d" },
  };
  return map[interval];
}

// ── Candle Cache ──────────────────────────────────────────

const candleCache = new Map<string, { data: Candle[]; fetchedAt: number }>();
const CANDLE_CACHE_TTL = 60_000; // 1 minute

function cacheKey(symbol: string, interval: Interval): string {
  return `${symbol}|${interval}`;
}

// ── Quote construction from Yahoo chart meta ──────────────
// The v8 chart endpoint returns full quote metadata, so a quote
// can be derived from the same request as the candles.

interface ChartActionOk {
  ok: true;
  candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
  meta: {
    symbol: string;
    currency: string;
    exchangeName: string;
    fullExchangeName: string;
    instrumentType: string;
    longName: string;
    shortName: string;
    regularMarketPrice: number | null;
    regularMarketChange: number | null;
    regularMarketChangePercent: number | null;
    regularMarketDayHigh: number | null;
    regularMarketDayLow: number | null;
    regularMarketOpen: number | null;
    regularMarketVolume: number | null;
    previousClose: number | null;
    chartPreviousClose: number | null;
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
    regularMarketTime: number | null;
  };
  splits: Array<{ date: number; split: string }>;
  dividends: Array<{ date: number; amount: number }>;
}

const fundamentalsCache = new Map<string, { data: FundamentalData; fetchedAt: number }>();
const FUNDAMENTALS_CACHE_TTL = 15 * 60_000; // 15 minutes

function buildQuoteFromChart(
  symbol: string,
  meta: ChartActionOk["meta"],
  fallbackPrice: number | null,
): StockQuote | null {
  const price = meta.regularMarketPrice ?? fallbackPrice;
  if (price == null || !Number.isFinite(price) || price <= 0) return null;

  const change = meta.regularMarketChange ?? null;
  const changePercent = meta.regularMarketChangePercent ?? null;
  const prevClose =
    meta.previousClose ??
    (change != null ? price - change : null) ??
    meta.chartPreviousClose ??
    price;

  return {
    symbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || symbol,
    price,
    change: change ?? (prevClose != null ? price - prevClose : 0),
    changePercent: changePercent ?? (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0),
    high24h: meta.regularMarketDayHigh ?? price,
    low24h: meta.regularMarketDayLow ?? price,
    open24h: meta.regularMarketOpen ?? prevClose ?? price,
    previousClose: prevClose,
    volume: meta.regularMarketVolume ?? 0,
    avgVolume30d: 0,
    marketCap: 0,
    peRatio: null,
    eps: null,
    week52High: meta.fiftyTwoWeekHigh ?? 0,
    week52Low: meta.fiftyTwoWeekLow ?? 0,
    dividendYield: null,
    beta: null,
    sector: "",
    industry: "",
    currency: meta.currency || "USD",
    exchange: meta.fullExchangeName || meta.exchangeName || "",
    lastUpdate: (meta.regularMarketTime ?? Date.now() / 1000) * 1000,
    dataStatus: "delayed",
  };
}

// ── Historical Candles ────────────────────────────────────

/**
 * Fetch historical OHLCV candles for a stock.
 * Returns candles in ascending time order.
 * Uses cache to avoid redundant requests.
 */
export async function fetchStockCandles(
  symbol: string,
  interval: Interval,
  limit: number = 200,
): Promise<Candle[]> {
  const key = cacheKey(symbol, interval);
  const cached = candleCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL) {
    return cached.data.slice(-limit);
  }

  const { range, interval: yfInterval } = intervalRangeMap(interval);
  const result = await callProxy<ChartActionOk>(
    "fetchChart",
    { symbol, range, interval: yfInterval },
    `chart|${symbol}|${range}|${yfInterval}`,
  );

  if (!result?.ok) {
    console.warn(`[StockDataEngine] No chart data for ${symbol} ${interval}`);
    return [];
  }

  const candles: Candle[] = result.candles.map((c) => ({
    time: c.time * 1000, // Yahoo sends seconds → app uses ms
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    closed: true,
  }));

  // Cache the result
  candleCache.set(key, { data: candles, fetchedAt: Date.now() });

  return candles.slice(-limit);
}

// ── Live Quote ────────────────────────────────────────────

/**
 * Fetch live/delayed quote data for a stock.
 * Returns null on failure — never fabricates data.
 */
export async function fetchStockQuote(symbol: string): Promise<StockQuote | null> {
  // 1y of daily candles doubles as the quote request — Yahoo's chart
  // meta carries the current price, change, day high/low, volume,
  // 52-week range, exchange and company name.
  const { range, interval: yfInterval } = intervalRangeMap("1d");
  const result = await callProxy<ChartActionOk>(
    "fetchChart",
    { symbol, range, interval: yfInterval },
    `chart|${symbol}|${range}|${yfInterval}`,
  );
  if (!result?.ok) return null;
  return buildQuoteFromChart(symbol, result.meta, null);
}

/**
 * Fetch quote and candles in a single chart request.
 * Saves one Yahoo round-trip compared to calling the two
 * functions separately — used by the stock page.
 */
export async function fetchStockQuoteAndCandles(
  symbol: string,
  interval: Interval,
  limit: number = 200,
): Promise<{ quote: StockQuote | null; candles: Candle[] }> {
  const { range, interval: yfInterval } = intervalRangeMap(interval);
  const key = `chart|${symbol}|${range}|${yfInterval}`;

  const cached = candleCache.get(cacheKey(symbol, interval));
  const result = await callProxy<ChartActionOk>(
    "fetchChart",
    { symbol, range, interval: yfInterval },
    key,
  );

  if (!result?.ok) return { quote: null, candles: cached?.data.slice(-limit) ?? [] };

  const candles: Candle[] = result.candles.map((c) => ({
    time: c.time * 1000,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    closed: true,
  }));

  candleCache.set(cacheKey(symbol, interval), { data: candles, fetchedAt: Date.now() });

  const meta = result.meta;
  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : null;
  const quote = buildQuoteFromChart(symbol, meta, lastClose);

  return { quote, candles: candles.slice(-limit) };
}

/** Fetch corporate actions (splits/dividends) for a symbol+interval when available. */
export async function fetchStockCorporateActions(
  symbol: string,
  interval: Interval,
): Promise<CorporateActions> {
  const { range, interval: yfInterval } = intervalRangeMap(interval);
  const result = await callProxy<ChartActionOk>(
    "fetchChart",
    { symbol, range, interval: yfInterval },
    `chart|${symbol}|${range}|${yfInterval}`,
  );
  if (!result?.ok) return { splits: [], dividends: [] };
  return { splits: result.splits, dividends: result.dividends };
}

// ── Batch Quotes ──────────────────────────────────────────

/**
 * Fetch quotes for multiple symbols at once.
 * The Yahoo chart endpoint is per-symbol, so this fans out into
 * bounded-parallelism requests.
 */
export async function fetchBatchQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
  const results = new Map<string, StockQuote>();

  const CONCURRENCY = 3;
  const queue = [...symbols];

  async function worker(): Promise<void> {
    for (;;) {
      const symbol = queue.shift();
      if (!symbol) return;
      const quote = await fetchStockQuote(symbol);
      if (quote) results.set(quote.symbol, quote);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
  );

  return results;
}

// ── Stock Search ──────────────────────────────────────────

/**
 * Search for stocks by name or symbol.
 * Supports ticker, company name, partial search.
 */
export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  if (!query || query.length < 1) return [];

  const result = await callProxy<{
    ok: true;
    results: Array<{
      symbol: string;
      name: string;
      quoteType: string;
      exchange: string;
      sector: string;
      industry: string;
      marketCap: number;
    }>;
  }>("searchSymbols", { query }, `search|${query.trim().toLowerCase()}`);

  if (!result?.ok) {
    // If search fails, try to interpret the query as a direct symbol
    if (query.length >= 1 && query.length <= 5 && /^[A-Z]+$/i.test(query)) {
      return [{
        symbol: query.toUpperCase(),
        name: query.toUpperCase(),
        type: "equity" as const,
        exchange: "",
      }];
    }
    return [];
  }

  return result.results.map((q) => ({
    symbol: q.symbol,
    name: q.name,
    type:
      q.quoteType === "ETF"
        ? ("etf" as const)
        : q.quoteType === "INDEX"
          ? ("index" as const)
          : q.quoteType === "MUTUALFUND" || q.quoteType === "MUTUAL_FUND"
            ? ("mutual_fund" as const)
            : q.quoteType === "EQUITY"
              ? ("equity" as const)
              : ("other" as const),
    exchange: q.exchange,
    sector: q.sector || undefined,
    industry: q.industry || undefined,
    marketCap: q.marketCap || undefined,
  }));
}

// ── Fundamental Data ──────────────────────────────────────

/**
 * Fetch full fundamentals from Yahoo's quoteSummary endpoint
 * (crumb-authenticated server-side). Returns null on failure.
 */
export async function fetchStockFundamentals(symbol: string): Promise<FundamentalData | null> {
  const cached = fundamentalsCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < FUNDAMENTALS_CACHE_TTL) {
    return cached.data;
  }

  const result = await callProxy<{
    ok: true;
    summary: Record<string, unknown> & {
      sector: string;
      industry: string;
      marketCap: number | null;
      enterpriseValue: number | null;
      trailingPE: number | null;
      forwardPE: number | null;
      pegRatio: number | null;
      priceToBook: number | null;
      evToRevenue: number | null;
      evToEBITDA: number | null;
      profitMargin: number | null;
      operatingMargin: number | null;
      grossMargin: number | null;
      returnOnEquity: number | null;
      returnOnAssets: number | null;
      revenueGrowth: number | null;
      earningsGrowth: number | null;
      debtToEquity: number | null;
      currentRatio: number | null;
      quickRatio: number | null;
      bookValue: number | null;
      dividendYield: number | null;
      payoutRatio: number | null;
      beta: number | null;
      trailingEps: number | null;
      forwardEps: number | null;
      revenuePerShare: number | null;
      nextEarningsDate: number | null;
    };
  }>("getQuoteSummary", { symbol }, `summary|${symbol}`);

  if (!result?.ok) return null;

  const s = result.summary;
  const data: FundamentalData = {
    symbol,
    marketCap: s.marketCap ?? 0,
    enterpriseValue: s.enterpriseValue ?? 0,
    trailingPE: s.trailingPE,
    forwardPE: s.forwardPE,
    pegRatio: s.pegRatio,
    priceToBook: s.priceToBook,
    priceToSales: null,
    evToRevenue: s.evToRevenue,
    evToEBITDA: s.evToEBITDA,
    profitMargin: s.profitMargin,
    operatingMargin: s.operatingMargin,
    grossMargin: s.grossMargin,
    returnOnEquity: s.returnOnEquity,
    returnOnAssets: s.returnOnAssets,
    revenueGrowth: s.revenueGrowth,
    earningsGrowth: s.earningsGrowth,
    debtToEquity: s.debtToEquity,
    currentRatio: s.currentRatio,
    quickRatio: s.quickRatio,
    bookValue: s.bookValue,
    dividendYield: s.dividendYield,
    payoutRatio: s.payoutRatio,
    beta: s.beta,
    trailingEps: s.trailingEps,
    forwardEps: s.forwardEps,
    revenuePerShare: s.revenuePerShare,
    lastFiscalYearEnd: null,
    nextEarningsDate: s.nextEarningsDate ? s.nextEarningsDate * 1000 : null,
    dataStatus: "available",
  };

  fundamentalsCache.set(symbol, { data, fetchedAt: Date.now() });
  return data;
}

/**
 * Extract fundamental data from a StockQuote (local, no network).
 * Kept for compatibility — use fetchStockFundamentals for real data.
 */
export function extractFundamentals(quote: StockQuote): FundamentalData {
  return {
    symbol: quote.symbol,
    marketCap: quote.marketCap,
    enterpriseValue: 0,
    trailingPE: quote.peRatio,
    forwardPE: null,
    pegRatio: null,
    priceToBook: null,
    priceToSales: null,
    evToRevenue: null,
    evToEBITDA: null,
    profitMargin: null,
    operatingMargin: null,
    grossMargin: null,
    returnOnEquity: null,
    returnOnAssets: null,
    revenueGrowth: null,
    earningsGrowth: null,
    debtToEquity: null,
    currentRatio: null,
    quickRatio: null,
    bookValue: null,
    dividendYield: quote.dividendYield,
    payoutRatio: null,
    beta: quote.beta,
    trailingEps: quote.eps,
    forwardEps: null,
    revenuePerShare: null,
    lastFiscalYearEnd: null,
    nextEarningsDate: null,
    dataStatus: quote.peRatio !== null ? "partial" : "unavailable",
  };
}
