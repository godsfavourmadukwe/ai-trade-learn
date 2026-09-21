"use node";

// ============================================================
// STOCK DATA — Convex server-side Yahoo Finance proxy
//
// Yahoo Finance does not set CORS headers, so browser fetch()
// cannot reach it directly. All Yahoo traffic therefore goes
// through these server-side actions (same pattern as
// marketProxy.ts for Binance).
//
// Endpoints used (no API key required):
//   v8/finance/chart         → candles + quote metadata (public)
//   v1/finance/search        → symbol discovery (public)
//   v10/finance/quoteSummary → fundamentals (requires cookie + crumb)
//
// The cookie/crumb session is fetched once, cached in the module,
// and transparently refreshed when Yahoo answers 401.
//
// NEVER fabricates data: on any failure the action returns
// { ok: false, error } and the frontend reports it clearly.
// ============================================================

import { v } from "convex/values";
import { action } from "./_generated/server";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const YAHOO = "https://query1.finance.yahoo.com";

const VALID_SYMBOL = /^[A-Za-z0-9.\-^=]{1,20}$/;

function normalizeSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase();
  if (!symbol || !VALID_SYMBOL.test(symbol)) return null;
  return symbol;
}

// ── Yahoo session (cookie + crumb) ────────────────────────
// v10/quoteSummary rejects requests without a valid crumb, and
// the crumb is only issued together with Yahoo cookies.

interface YahooSession {
  cookie: string;
  crumb: string;
  fetchedAt: number;
}

let yahooSession: YahooSession | null = null;
const SESSION_TTL_MS = 25 * 60 * 1000;

function cookiesFromResponse(res: Response): string {
  const headers = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const pairs: string[] = [];
  for (const c of setCookies) {
    const pair = c.split(";")[0];
    if (pair && pair.includes("=")) pairs.push(pair.trim());
  }
  return pairs.join("; ");
}

async function getYahooSession(force = false): Promise<YahooSession> {
  if (!force && yahooSession && Date.now() - yahooSession.fetchedAt < SESSION_TTL_MS) {
    return yahooSession;
  }
  // fc.yahoo.com normally answers 404 — the cookies arrive regardless.
  const cookieRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
  });
  const cookie = cookiesFromResponse(cookieRes);
  if (!cookie) throw new Error("Yahoo session: fc.yahoo.com set no cookies");

  const crumbRes = await fetch(`${YAHOO}/v1/test/getcrumb`, {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  if (!crumbRes.ok) throw new Error(`Yahoo crumb fetch failed: HTTP ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 64) throw new Error("Yahoo session: invalid crumb");

  yahooSession = { cookie, crumb, fetchedAt: Date.now() };
  return yahooSession;
}

/** Fetch Yahoo JSON, retrying once through a fresh session on 401/403. */
async function yahooJson<T>(url: string, needsSession: boolean): Promise<T> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: "application/json",
    };
    let requestUrl = url;
    if (needsSession) {
      const session = await getYahooSession(attempt > 0);
      headers.Cookie = session.cookie;
      requestUrl = `${url}&crumb=${encodeURIComponent(session.crumb)}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let res: Response;
    try {
      res = await fetch(requestUrl, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    lastStatus = res.status;
    if (res.ok) return (await res.json()) as T;
    if (res.status === 401 || res.status === 403) continue; // stale session → refresh and retry
    if (res.status === 404) throw new Error("Symbol not found (HTTP 404)");
    if (res.status === 429) throw new Error("Rate limited by Yahoo (HTTP 429) — retry shortly");
    throw new Error(`Yahoo request failed: HTTP ${res.status}`);
  }
  throw new Error(`Yahoo unauthorized after session refresh (HTTP ${lastStatus})`);
}

// ── Shared Yahoo response types ───────────────────────────

type YahooField = number | string | { raw?: unknown } | null | undefined;

function rawNumber(x: YahooField): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (x && typeof x === "object" && "raw" in x) {
    const v = x.raw;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return null;
}

function rawString(x: YahooField): string | null {
  if (typeof x === "string") return x;
  if (x && typeof x === "object" && "raw" in x && typeof x.raw === "string") return x.raw;
  return null;
}

interface YahooChartResult {
  meta?: {
    symbol?: string;
    currency?: string;
    exchangeName?: string;
    fullExchangeName?: string;
    instrumentType?: string;
    longName?: string;
    shortName?: string;
    regularMarketPrice?: number | null;
    regularMarketChange?: number | null;
    regularMarketChangePercent?: number | null;
    regularMarketDayHigh?: number | null;
    regularMarketDayLow?: number | null;
    regularMarketVolume?: number | null;
    regularMarketOpen?: number | null;
    previousClose?: number | null;
    chartPreviousClose?: number | null;
    fiftyTwoWeekHigh?: number | null;
    fiftyTwoWeekLow?: number | null;
    regularMarketTime?: number | null;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
  events?: {
    splits?: Record<string, { split?: string }>;
    dividends?: Record<string, { amount?: number }>;
  };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: { code?: string; description?: string } | null;
  };
}

interface YahooSearchResponse {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    exchange?: string;
    exchDisp?: string;
    sectorDisp?: string;
    industryDisp?: string;
    marketCap?: YahooField;
  }>;
}

interface YahooSummaryResponse {
  quoteSummary?: {
    result?: Array<{
      price?: {
        regularMarketPrice?: YahooField;
        regularMarketChange?: YahooField;
        regularMarketChangePercent?: YahooField;
        regularMarketVolume?: YahooField;
        regularMarketTime?: YahooField;
        marketCap?: YahooField;
      };
      summaryDetail?: {
        trailingPE?: YahooField;
        forwardPE?: YahooField;
        dividendYield?: YahooField;
        payoutRatio?: YahooField;
        beta?: YahooField;
        fiftyTwoWeekHigh?: YahooField;
        fiftyTwoWeekLow?: YahooField;
        previousClose?: YahooField;
        open?: YahooField;
        dayHigh?: YahooField;
        dayLow?: YahooField;
        averageVolume?: YahooField;
      };
      defaultKeyStatistics?: {
        trailingEps?: YahooField;
        forwardEps?: YahooField;
        pegRatio?: YahooField;
        bookValue?: YahooField;
        priceToBook?: YahooField;
        enterpriseValue?: YahooField;
        enterpriseToRevenue?: YahooField;
        enterpriseToEbitda?: YahooField;
        sharesOutstanding?: YahooField;
        earningsGrowth?: YahooField;
      };
      assetProfile?: {
        sector?: string;
        industry?: string;
      };
      financialData?: {
        profitMargins?: YahooField;
        operatingMargins?: YahooField;
        grossMargins?: YahooField;
        returnOnEquity?: YahooField;
        returnOnAssets?: YahooField;
        revenueGrowth?: YahooField;
        earningsGrowth?: YahooField;
        debtToEquity?: YahooField;
        currentRatio?: YahooField;
        quickRatio?: YahooField;
        revenuePerShare?: YahooField;
      };
      calendarEvents?: {
        earnings?: {
          earningsDate?: YahooField[];
        };
      };
    }>;
  };
}

// ── Chart (candles + quote metadata) ──────────────────────

export const fetchChart = action({
  args: {
    symbol: v.string(),
    range: v.string(),
    interval: v.string(),
  },
  handler: async (_ctx, args) => {
    const symbol = normalizeSymbol(args.symbol);
    if (!symbol) return { ok: false as const, error: `Invalid symbol format: "${args.symbol}"` };

    const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(
      args.range,
    )}&interval=${encodeURIComponent(args.interval)}&includePrePost=false`;

    try {
      const data = await yahooJson<YahooChartResponse>(url, false);
      const result = data.chart?.result?.[0];
      if (!result) {
        const desc = data.chart?.error?.description ?? "no chart result";
        return { ok: false as const, error: `Yahoo chart: ${desc}` };
      }

      const ts = result.timestamp ?? [];
      const q = result.indicators?.quote?.[0];
      const candles: Array<{
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }> = [];

      if (q && ts.length > 0) {
        for (let i = 0; i < ts.length; i++) {
          const o = q.open?.[i];
          const h = q.high?.[i];
          const l = q.low?.[i];
          const c = q.close?.[i];
          const v = q.volume?.[i];
          if (o == null || h == null || l == null || c == null || v == null) continue;
          if (![o, h, l, c, v].every(Number.isFinite)) continue;
          if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
          if (h < l) continue;
          candles.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: v });
        }
        candles.sort((a, b) => a.time - b.time);
      }

      const m = result.meta ?? {};
      const meta = {
        symbol: rawString(m.symbol) ?? symbol,
        currency: rawString(m.currency) ?? "USD",
        exchangeName: rawString(m.exchangeName) ?? "",
        fullExchangeName: rawString(m.fullExchangeName) ?? rawString(m.exchangeName) ?? "",
        instrumentType: rawString(m.instrumentType) ?? "",
        longName: rawString(m.longName) ?? "",
        shortName: rawString(m.shortName) ?? "",
        regularMarketPrice: rawNumber(m.regularMarketPrice ?? null),
        regularMarketChange: rawNumber(m.regularMarketChange ?? null),
        regularMarketChangePercent: rawNumber(m.regularMarketChangePercent ?? null),
        regularMarketDayHigh: rawNumber(m.regularMarketDayHigh ?? null),
        regularMarketDayLow: rawNumber(m.regularMarketDayLow ?? null),
        regularMarketOpen: rawNumber(m.regularMarketOpen ?? null),
        regularMarketVolume: rawNumber(m.regularMarketVolume ?? null),
        previousClose: rawNumber(m.previousClose ?? null),
        chartPreviousClose: rawNumber(m.chartPreviousClose ?? null),
        fiftyTwoWeekHigh: rawNumber(m.fiftyTwoWeekHigh ?? null),
        fiftyTwoWeekLow: rawNumber(m.fiftyTwoWeekLow ?? null),
        regularMarketTime: rawNumber(m.regularMarketTime ?? null),
      };

      const splits = Object.entries(result.events?.splits ?? {}).map(([dateStr, s]) => ({
        date: Number(dateStr) * 1000,
        split: s.split ?? "",
      }));
      const dividends = Object.entries(result.events?.dividends ?? {}).map(([dateStr, d]) => ({
        date: Number(dateStr) * 1000,
        amount: d.amount ?? 0,
      }));

      return { ok: true as const, candles, meta, splits, dividends };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

// ── Symbol search ─────────────────────────────────────────

const SEARCHABLE_TYPES = new Set(["EQUITY", "ETF", "INDEX", "MUTUALFUND", "MUTUAL_FUND"]);

export const searchSymbols = action({
  args: { query: v.string() },
  handler: async (_ctx, args) => {
    const query = args.query.trim();
    if (!query) return { ok: true as const, results: [] };

    const url = `${YAHOO}/v1/finance/search?q=${encodeURIComponent(
      query,
    )}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false`;

    try {
      const data = await yahooJson<YahooSearchResponse>(url, false);
      const results = (data.quotes ?? [])
        .filter((q) => q.symbol && SEARCHABLE_TYPES.has(q.quoteType ?? ""))
        .map((q) => ({
          symbol: q.symbol as string,
          name: rawString(q.longname ?? null) || rawString(q.shortname ?? null) || (q.symbol as string),
          quoteType: q.quoteType ?? "EQUITY",
          exchange: rawString(q.exchDisp ?? null) || rawString(q.exchange ?? null) || "",
          sector: rawString(q.sectorDisp ?? null) ?? "",
          industry: rawString(q.industryDisp ?? null) ?? "",
          marketCap: rawNumber(q.marketCap) ?? 0,
        }));
      return { ok: true as const, results };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

// ── Fundamentals (crumb-gated quoteSummary) ───────────────

const SUMMARY_MODULES =
  "price,summaryDetail,defaultKeyStatistics,assetProfile,financialData,calendarEvents";

export const getQuoteSummary = action({
  args: { symbol: v.string() },
  handler: async (_ctx, args) => {
    const symbol = normalizeSymbol(args.symbol);
    if (!symbol) return { ok: false as const, error: `Invalid symbol format: "${args.symbol}"` };

    const url = `${YAHOO}/v10/finance/quoteSummary/${encodeURIComponent(
      symbol,
    )}?modules=${SUMMARY_MODULES}`;

    try {
      const data = await yahooJson<YahooSummaryResponse>(url, true);
      const r = data.quoteSummary?.result?.[0];
      if (!r) return { ok: false as const, error: "Yahoo quoteSummary: no result" };

      const price = r.price ?? {};
      const detail = r.summaryDetail ?? {};
      const stats = r.defaultKeyStatistics ?? {};
      const profile = r.assetProfile ?? {};
      const fin = r.financialData ?? {};

      const earningsDates = (r.calendarEvents?.earnings?.earningsDate ?? [])
        .map((d) => rawNumber(d))
        .filter((d): d is number => d != null);

      const summary = {
        symbol,
        sector: profile.sector ?? "",
        industry: profile.industry ?? "",
        marketCap: rawNumber(price.marketCap),
        enterpriseValue: rawNumber(stats.enterpriseValue),
        trailingPE: rawNumber(detail.trailingPE),
        forwardPE: rawNumber(detail.forwardPE),
        pegRatio: rawNumber(stats.pegRatio),
        priceToBook: rawNumber(stats.priceToBook),
        priceToSales: null,
        evToRevenue: rawNumber(stats.enterpriseToRevenue),
        evToEBITDA: rawNumber(stats.enterpriseToEbitda),
        profitMargin: rawNumber(fin.profitMargins),
        operatingMargin: rawNumber(fin.operatingMargins),
        grossMargin: rawNumber(fin.grossMargins),
        returnOnEquity: rawNumber(fin.returnOnEquity),
        returnOnAssets: rawNumber(fin.returnOnAssets),
        revenueGrowth: rawNumber(fin.revenueGrowth),
        earningsGrowth: rawNumber(fin.earningsGrowth ?? stats.earningsGrowth ?? null),
        debtToEquity: rawNumber(fin.debtToEquity),
        currentRatio: rawNumber(fin.currentRatio),
        quickRatio: rawNumber(fin.quickRatio),
        bookValue: rawNumber(stats.bookValue),
        dividendYield: rawNumber(detail.dividendYield),
        payoutRatio: rawNumber(detail.payoutRatio),
        beta: rawNumber(detail.beta),
        trailingEps: rawNumber(stats.trailingEps),
        forwardEps: rawNumber(stats.forwardEps),
        revenuePerShare: rawNumber(fin.revenuePerShare),
        sharesOutstanding: rawNumber(stats.sharesOutstanding),
        averageVolume: rawNumber(detail.averageVolume),
        week52High: rawNumber(detail.fiftyTwoWeekHigh),
        week52Low: rawNumber(detail.fiftyTwoWeekLow),
        previousClose: rawNumber(detail.previousClose),
        open: rawNumber(detail.open),
        dayHigh: rawNumber(detail.dayHigh),
        dayLow: rawNumber(detail.dayLow),
        regularMarketVolume: rawNumber(price.regularMarketVolume),
        nextEarningsDate: earningsDates.length > 0 ? Math.min(...earningsDates) : null,
      };

      return { ok: true as const, summary };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
