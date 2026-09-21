// ============================================================
// STOCK MARKET INTELLIGENCE — Stock Data Engine
//
// Professional stock data engine using Yahoo Finance's free
// API. Provides live prices, historical OHLCV, fundamentals,
// and stock search. Never fabricates data — if the API is
// unavailable, it reports the failure clearly.
//
// Yahoo Finance endpoints (no API key required):
//   - Chart data:   /v8/finance/chart/{symbol}
//   - Search:       /v1/finance/search?q={query}
//   - Quote:        /v7/finance/quote?symbols={symbols}
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

// ── Yahoo Finance API Client ──────────────────────────────

const YAHOO_BASE = "https://query1.finance.yahoo.com";
const YAHOO_V8 = `${YAHOO_BASE}/v8/finance/chart`;
const YAHOO_V7 = `${YAHOO_BASE}/v7/finance/quote`;
const YAHOO_SEARCH = `${YAHOO_BASE}/v1/finance/search`;

// Rate limiting
const requestTimestamps: number[] = [];
const MAX_REQUESTS_PER_SECOND = 5;
const REQUEST_DELAY_MS = 250;

function rateLimit(): Promise<void> {
  const now = Date.now();
  // Remove timestamps older than 1 second
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - 1000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_REQUESTS_PER_SECOND) {
    const waitTime = REQUEST_DELAY_MS;
    return new Promise((resolve) => setTimeout(resolve, waitTime));
  }
  requestTimestamps.push(now);
  return Promise.resolve();
}

async function fetchYahoo<T>(url: string): Promise<T | null> {
  await rateLimit();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TRADSLY/1.0)",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[StockDataEngine] Yahoo API error: ${response.status} for ${url}`);
      return null;
    }
    return await response.json() as T;
  } catch (err) {
    console.warn(`[StockDataEngine] Fetch error:`, err);
    return null;
  }
}

// ── Interval Mapping ──────────────────────────────────────

function intervalToYahoo(interval: Interval): string {
  const map: Record<Interval, string> = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1h",
    "4h": "1d", // Yahoo doesn't have 4h, use daily
    "1d": "1d",
  };
  return map[interval];
}

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

// ── Historical Candles ────────────────────────────────────

/**
 * Fetch historical OHLCV candles for a stock.
 * Returns candles in ascending time order.
 * Never returns fake data — returns empty array on failure.
 */
export async function fetchStockCandles(
  symbol: string,
  interval: Interval,
  limit: number = 200,
): Promise<Candle[]> {
  const { range, interval: yfInterval } = intervalRangeMap(interval);

  const url = `${YAHOO_V8}/${encodeURIComponent(symbol)}?range=${range}&interval=${yfInterval}&includePrePost=false`;
  const data = await fetchYahoo<YahooChartResponse>(url);

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

    // Skip invalid/missing candles
    if (o == null || h == null || l == null || c == null || v == null) continue;
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
    if (h < l) continue;

    candles.push({
      time: timestamps[i] * 1000, // Convert to ms
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

  // Return the last `limit` candles
  return candles.slice(-limit);
}

// ── Live Quote ────────────────────────────────────────────

/**
 * Fetch live/delayed quote data for a stock.
 * Returns null on failure — never fabricates data.
 */
export async function fetchStockQuote(symbol: string): Promise<StockQuote | null> {
  const url = `${YAHOO_V7}?symbols=${encodeURIComponent(symbol)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow,regularMarketOpen,regularMarketPreviousClose,regularMarketVolume,averageDailyVolume3Month,marketCap,trailingPE,epsTrailingTwelveMonths,fiftyTwoWeekHigh,fiftyTwoWeekLow,dividendYield,beta,shortName,longName,sector,industry,currency,fullExchangeName,regularMarketTime`;

  const data = await fetchYahoo<YahooQuoteResponse>(url);

  if (!data?.quoteResponse?.result?.[0]) {
    return null;
  }

  const q = data.quoteResponse.result[0];

  return {
    symbol: q.symbol ?? symbol,
    name: q.longName ?? q.shortName ?? symbol,
    price: q.regularMarketPrice ?? 0,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    high24h: q.regularMarketDayHigh ?? 0,
    low24h: q.regularMarketDayLow ?? 0,
    open24h: q.regularMarketOpen ?? 0,
    previousClose: q.regularMarketPreviousClose ?? 0,
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
    dataStatus: q.regularMarketPrice ? "delayed" : "unavailable",
  };
}

// ── Batch Quotes ──────────────────────────────────────────

/**
 * Fetch quotes for multiple symbols at once.
 */
export async function fetchBatchQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
  const results = new Map<string, StockQuote>();

  // Yahoo allows ~20 symbols per request
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 20) {
    chunks.push(symbols.slice(i, i + 20));
  }

  for (const chunk of chunks) {
    const url = `${YAHOO_V7}?symbols=${chunk.map(encodeURIComponent).join(",")}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow,regularMarketOpen,regularMarketPreviousClose,regularMarketVolume,averageDailyVolume3Month,marketCap,shortName,longName,sector,industry,currency,fullExchangeName,regularMarketTime`;

    const data = await fetchYahoo<YahooQuoteResponse>(url);

    if (data?.quoteResponse?.result) {
      for (const q of data.quoteResponse.result) {
        results.set(q.symbol, {
          symbol: q.symbol,
          name: q.longName ?? q.shortName ?? q.symbol,
          price: q.regularMarketPrice ?? 0,
          change: q.regularMarketChange ?? 0,
          changePercent: q.regularMarketChangePercent ?? 0,
          high24h: q.regularMarketDayHigh ?? 0,
          low24h: q.regularMarketDayLow ?? 0,
          open24h: q.regularMarketOpen ?? 0,
          previousClose: q.regularMarketPreviousClose ?? 0,
          volume: q.regularMarketVolume ?? 0,
          avgVolume30d: q.averageDailyVolume3Month ?? 0,
          marketCap: q.marketCap ?? 0,
          peRatio: null,
          eps: null,
          week52High: 0,
          week52Low: 0,
          dividendYield: null,
          beta: null,
          sector: q.sector ?? "",
          industry: q.industry ?? "",
          currency: q.currency ?? "USD",
          exchange: q.fullExchangeName ?? "",
          lastUpdate: (q.regularMarketTime ?? Date.now() / 1000) * 1000,
          dataStatus: q.regularMarketPrice ? "delayed" : "unavailable",
        });
      }
    }
  }

  return results;
}

// ── Stock Search ──────────────────────────────────────────

/**
 * Search for stocks by name or symbol.
 */
export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  if (!query || query.length < 1) return [];

  const url = `${YAHOO_SEARCH}?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
  const data = await fetchYahoo<YahooSearchResponse>(url);

  if (!data?.quotes) return [];

  return data.quotes
    .filter((q) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF"))
    .map((q) => ({
      symbol: q.symbol,
      name: q.shortname ?? q.longname ?? q.symbol,
      type: q.quoteType === "ETF" ? "etf" as const : "equity" as const,
      exchange: q.exchange ?? "",
      sector: undefined,
      industry: undefined,
      marketCap: q.marketCap ?? undefined,
    }));
}

// ── Fundamental Data ──────────────────────────────────────

/**
 * Extract fundamental data from Yahoo Finance chart response.
 * This provides what's available from the free API.
 */
export function extractFundamentals(quote: StockQuote): FundamentalData {
  return {
    symbol: quote.symbol,
    marketCap: quote.marketCap,
    enterpriseValue: 0, // Not available from free API
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
