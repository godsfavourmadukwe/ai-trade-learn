// ============================================================
// STOCK MARKET INTELLIGENCE — Stock Data Engine
//
// Professional stock data engine using Yahoo Finance API.
// Uses api.allorigins.win as CORS proxy since Yahoo Finance
// does not set CORS headers for browser requests.
//
// Provides: live quotes, historical OHLCV, search, fundamentals.
// NEVER fabricates data — reports failures clearly.
//
// Data flow:
//   Browser → allorigins proxy → Yahoo Finance API → proxy → Browser
// ============================================================

import type { Interval, Candle } from "@/lib/market/types";

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
  proxyUsed: "allorigins",
  avgLatencyMs: 0,
};

export function getDiagnostics(): DataDiagnostics {
  return { ...diagnostics };
}

function recordSuccess(latencyMs: number): void {
  diagnostics.lastSuccess = Date.now();
  diagnostics.consecutiveErrors = 0;
  diagnostics.avgLatencyMs = diagnostics.avgLatencyMs > 0
    ? (diagnostics.avgLatencyMs + latencyMs) / 2
    : latencyMs;
}

function recordError(error: string): void {
  diagnostics.lastError = error;
  diagnostics.totalErrors++;
  diagnostics.consecutiveErrors++;
}

// ── CORS Proxy Layer ──────────────────────────────────────
//
// Yahoo Finance does NOT set CORS headers. Browser fetch() fails
// with a network error. We use api.allorigins.win which fetches
// the URL server-side and returns the response body.

const ALLORIGINS_BASE = "https://api.allorigins.win/raw?url=";

// Rate limiting
const requestTimestamps: number[] = [];
const MAX_REQUESTS_PER_SECOND = 3;

function rateLimit(): Promise<void> {
  const now = Date.now();
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - 1000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_REQUESTS_PER_SECOND) {
    return new Promise((resolve) => setTimeout(resolve, 400));
  }
  requestTimestamps.push(now);
  return Promise.resolve();
}

/**
 * Fetch JSON through the CORS proxy. The proxy returns the raw
 * response body from the target URL.
 */
async function fetchViaProxy<T>(targetUrl: string): Promise<T | null> {
  await rateLimit();
  diagnostics.lastAttempt = Date.now();
  diagnostics.totalRequests++;

  const proxyUrl = `${ALLORIGINS_BASE}${encodeURIComponent(targetUrl)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const start = Date.now();

    const response = await fetch(proxyUrl, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const msg = `Proxy HTTP ${response.status}`;
      recordError(msg);
      console.warn(`[StockDataEngine] ${msg} for ${targetUrl}`);
      return null;
    }

    const text = await response.text();
    if (!text || text.length < 2) {
      recordError("Empty proxy response");
      return null;
    }

    const data = JSON.parse(text) as T;
    recordSuccess(Date.now() - start);
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordError(msg);
    console.warn(`[StockDataEngine] Fetch error: ${msg}`);
    return null;
  }
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
  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${yfInterval}&includePrePost=false`;

  const data = await fetchViaProxy<YahooChartResponse>(targetUrl);

  if (!data?.chart?.result?.[0]) {
    console.warn(`[StockDataEngine] No chart data for ${symbol} ${interval}`);
    return [];
  }

  const result = data.chart.result[0];
  const timestamps = result.timestamp;
  const ohlcv = result.indicators?.quote?.[0];

  if (!timestamps || !ohlcv || timestamps.length === 0) {
    return [];
  }

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = ohlcv.open?.[i];
    const h = ohlcv.high?.[i];
    const l = ohlcv.low?.[i];
    const c = ohlcv.close?.[i];
    const v = ohlcv.volume?.[i];

    // Validate each candle
    if (o == null || h == null || l == null || c == null || v == null) continue;
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
    if (h < l) continue;

    candles.push({
      time: timestamps[i] * 1000,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v,
      closed: true,
    });
  }

  // Ensure ascending order
  candles.sort((a, b) => a.time - b.time);

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
  const fields = [
    "regularMarketPrice",
    "regularMarketChange",
    "regularMarketChangePercent",
    "regularMarketDayHigh",
    "regularMarketDayLow",
    "regularMarketOpen",
    "regularMarketPreviousClose",
    "regularMarketVolume",
    "averageDailyVolume3Month",
    "marketCap",
    "trailingPE",
    "epsTrailingTwelveMonths",
    "fiftyTwoWeekHigh",
    "fiftyTwoWeekLow",
    "dividendYield",
    "beta",
    "shortName",
    "longName",
    "sector",
    "industry",
    "currency",
    "fullExchangeName",
    "regularMarketTime",
  ].join(",");

  const targetUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&fields=${fields}`;

  const data = await fetchViaProxy<YahooQuoteResponse>(targetUrl);

  if (!data?.quoteResponse?.result?.[0]) {
    console.warn(`[StockDataEngine] No quote data for ${symbol}`);
    return null;
  }

  const q = data.quoteResponse.result[0];

  // Validate price is present and reasonable
  if (q.regularMarketPrice == null || !Number.isFinite(q.regularMarketPrice) || q.regularMarketPrice <= 0) {
    console.warn(`[StockDataEngine] Invalid price for ${symbol}: ${q.regularMarketPrice}`);
    return null;
  }

  return {
    symbol: q.symbol ?? symbol,
    name: q.longName ?? q.shortName ?? symbol,
    price: q.regularMarketPrice,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    high24h: q.regularMarketDayHigh ?? q.regularMarketPrice,
    low24h: q.regularMarketDayLow ?? q.regularMarketPrice,
    open24h: q.regularMarketOpen ?? q.regularMarketPrice,
    previousClose: q.regularMarketPreviousClose ?? q.regularMarketPrice,
    volume: q.regularMarketVolume ?? 0,
    avgVolume30d: q.averageDailyVolume3Month ?? 0,
    marketCap: q.marketCap ?? 0,
    peRatio: q.trailingPE ?? null,
    eps: q.epsTrailingTwelveMonths ?? null,
    week52High: q.fiftyTwoWeekHigh ?? 0,
    week52Low: q.fiftyTwoWeekLow ?? 0,
    dividendYield: q.dividendYield ?? null,
    beta: q.beta ?? null,
    sector: q.sector ?? "",
    industry: q.industry ?? "",
    currency: q.currency ?? "USD",
    exchange: q.fullExchangeName ?? "",
    lastUpdate: (q.regularMarketTime ?? Date.now() / 1000) * 1000,
    dataStatus: "delayed",
  };
}

// ── Batch Quotes ──────────────────────────────────────────

/**
 * Fetch quotes for multiple symbols at once.
 */
export async function fetchBatchQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
  const results = new Map<string, StockQuote>();

  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 20) {
    chunks.push(symbols.slice(i, i + 20));
  }

  for (const chunk of chunks) {
    const fields = "regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow,regularMarketOpen,regularMarketPreviousClose,regularMarketVolume,averageDailyVolume3Month,marketCap,shortName,longName,sector,industry,currency,fullExchangeName,regularMarketTime";
    const targetUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${chunk.map(encodeURIComponent).join(",")}&fields=${fields}`;

    const data = await fetchViaProxy<YahooQuoteResponse>(targetUrl);

    if (data?.quoteResponse?.result) {
      for (const q of data.quoteResponse.result) {
        if (q.regularMarketPrice == null || !Number.isFinite(q.regularMarketPrice) || q.regularMarketPrice <= 0) continue;

        results.set(q.symbol, {
          symbol: q.symbol,
          name: q.longName ?? q.shortName ?? q.symbol,
          price: q.regularMarketPrice,
          change: q.regularMarketChange ?? 0,
          changePercent: q.regularMarketChangePercent ?? 0,
          high24h: q.regularMarketDayHigh ?? q.regularMarketPrice,
          low24h: q.regularMarketDayLow ?? q.regularMarketPrice,
          open24h: q.regularMarketOpen ?? q.regularMarketPrice,
          previousClose: q.regularMarketPreviousClose ?? q.regularMarketPrice,
          volume: q.regularMarketVolume ?? 0,
          avgVolume30d: q.averageDailyVolume3Month ?? 0,
          marketCap: q.marketCap ?? 0,
          peRatio: q.trailingPE ?? null,
          eps: q.epsTrailingTwelveMonths ?? null,
          week52High: q.fiftyTwoWeekHigh ?? 0,
          week52Low: q.fiftyTwoWeekLow ?? 0,
          dividendYield: q.dividendYield ?? null,
          beta: q.beta ?? null,
          sector: q.sector ?? "",
          industry: q.industry ?? "",
          currency: q.currency ?? "USD",
          exchange: q.fullExchangeName ?? "",
          lastUpdate: (q.regularMarketTime ?? Date.now() / 1000) * 1000,
          dataStatus: "delayed",
        });
      }
    }
  }

  return results;
}

// ── Stock Search ──────────────────────────────────────────

/**
 * Search for stocks by name or symbol.
 * Supports ticker, company name, partial search.
 */
export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  if (!query || query.length < 1) return [];

  const targetUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false`;

  const data = await fetchViaProxy<YahooSearchResponse>(targetUrl);

  if (!data?.quotes) {
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

  return data.quotes
    .filter((q) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF" || q.quoteType === "INDEX"))
    .map((q) => ({
      symbol: q.symbol,
      name: q.shortname ?? q.longname ?? q.symbol,
      type: q.quoteType === "ETF" ? "etf" as const : q.quoteType === "INDEX" ? "index" as const : "equity" as const,
      exchange: q.exchange ?? "",
      sector: undefined,
      industry: undefined,
      marketCap: q.marketCap ?? undefined,
    }));
}

// ── Fundamental Data ──────────────────────────────────────

/**
 * Extract fundamental data from a StockQuote.
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

// ── Yahoo Finance Response Types ──────────────────────────

interface YahooChartResponse {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
      };
      meta: {
        symbol: string;
        regularMarketPrice: number;
        previousClose: number;
      };
    }>;
    error: unknown;
  };
}

interface YahooQuoteResponse {
  quoteResponse: {
    result: Array<{
      symbol: string;
      shortName?: string;
      longName?: string;
      regularMarketPrice?: number;
      regularMarketChange?: number;
      regularMarketChangePercent?: number;
      regularMarketDayHigh?: number;
      regularMarketDayLow?: number;
      regularMarketOpen?: number;
      regularMarketPreviousClose?: number;
      regularMarketVolume?: number;
      averageDailyVolume3Month?: number;
      marketCap?: number;
      trailingPE?: number;
      epsTrailingTwelveMonths?: number;
      fiftyTwoWeekHigh?: number;
      fiftyTwoWeekLow?: number;
      dividendYield?: number;
      beta?: number;
      sector?: string;
      industry?: string;
      currency?: string;
      fullExchangeName?: string;
      regularMarketTime?: number;
    }>;
  };
}

interface YahooSearchResponse {
  quotes: Array<{
    symbol: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    exchange?: string;
    marketCap?: number;
  }>;
}
