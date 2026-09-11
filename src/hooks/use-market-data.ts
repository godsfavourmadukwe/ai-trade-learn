import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { marketEngine, type EngineSnapshot, type EngineDiagnosticsDetail } from "@/lib/market/engine";
import { PAIRS, EXCHANGE_SYMBOLS, displayName } from "@/lib/market/symbols";
import type { Candle, FeedHealth, Interval } from "@/lib/market/types";

export type { Candle };
export type { Interval };
export type { FeedHealth };

export interface MarketData {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  change24hPercent: number;
  volume: number;
  marketCap: number;
  high24h: number;
  low24h: number;
  open: number;
  previousClose: number;
  candles: Candle[];
  lastUpdated: number;
  source: string;
}

interface UseMarketDataReturn {
  data: MarketData[];
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  refresh: () => void;
  getPairData: (symbol: string) => MarketData | undefined;
  dataSource: string;
  feedHealth: FeedHealth;
  activeProvider: string;
  candlesFor: (symbol: string, interval: Interval) => Candle[];
  selectedInterval: Interval;
  setInterval: (interval: Interval) => void;
  tickAgeMs: number;
  diagnosticsDetail: EngineDiagnosticsDetail;
}

const DEFAULT_INTERVAL: Interval = "1m";

// ── Browser-side REST fallback ─────────────────────────────
// When the Convex proxy is slow or unavailable, fetch directly from Binance's
// public market-data endpoint (api.binance.com is geo-blocked in some regions
// with HTTP 451). Runs in the browser.

const BROWSER_REST_PRIMARY = "https://data-api.binance.vision";
const BROWSER_REST_FALLBACK = "https://api.binance.com";
let browserRestBase = BROWSER_REST_PRIMARY;

async function binanceFetch(path: string): Promise<Response> {
  const primary = await fetch(`${browserRestBase}${path}`);
  if (primary.ok) return primary;
  if (browserRestBase === BROWSER_REST_PRIMARY) {
    browserRestBase = BROWSER_REST_FALLBACK;
    return fetch(`${browserRestBase}${path}`);
  }
  return primary;
}

async function browserFetchTickers(): Promise<void> {
  try {
    const symbolsParam = encodeURIComponent(JSON.stringify(EXCHANGE_SYMBOLS));
    const res = await binanceFetch(`/api/v3/ticker/24hr?symbols=${symbolsParam}`);
    if (!res.ok) return;
    const tickers = (await res.json()) as Array<{
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      highPrice: string;
      lowPrice: string;
      quoteVolume: string;
      openPrice: string;
    }>;
    for (const t of tickers) {
      if (!EXCHANGE_SYMBOLS.includes(t.symbol)) continue;
      const price = parseFloat(t.lastPrice);
      if (!Number.isFinite(price) || price <= 0) continue;
      marketEngine.ingestServerTicker({
        symbol: t.symbol,
        price,
        change24hPercent: parseFloat(t.priceChangePercent) || 0,
        high24h: parseFloat(t.highPrice) || price,
        low24h: parseFloat(t.lowPrice) || price,
        volume24h: parseFloat(t.quoteVolume) || 0,
        open24h: parseFloat(t.openPrice) || price,
        lastUpdate: Date.now(),
      });
    }
    marketEngine.markServerConnected();
  } catch {
    // Browser can't reach Binance — Convex proxy is the only way
  }
}

async function browserFetchCandles(symbol: string, interval: Interval, limit = 100): Promise<void> {
  try {
    const res = await binanceFetch(
      `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    if (!res.ok) return;
    const rows = (await res.json()) as unknown[][];
    if (!Array.isArray(rows)) return;
    const candles = rows
      .filter((r) => Array.isArray(r) && r.length >= 6)
      .map((r) => ({
        time: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
        closed: true,
      }))
      .filter((c) => c.time > 0 && c.open > 0 && c.close > 0 && c.high >= c.low);
    if (candles.length > 0) {
      marketEngine.ingestServerCandles(symbol, interval, candles);
    }
  } catch {
    // Browser can't reach Binance
  }
}

export function useMarketData(): UseMarketDataReturn {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<Interval>(DEFAULT_INTERVAL);
  const [tickAgeMs, setTickAgeMs] = useState(0);
  const mountedRef = useRef(true);
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");

  // ── Convex server-side data subscriptions ──
  const convexTickers = useQuery(api.marketProxy.getTickers);

  // Only fetch candles for the currently selected symbol (not all 10)
  const convexCandles = useQuery(api.marketProxy.getCandles, {
    symbol: selectedSymbol,
    interval: selectedInterval,
  });

  const startPolling = useAction(api.marketProxy.startPolling);
  const pollingStartedRef = useRef(false);

  // ── Start server-side polling on mount ──
  useEffect(() => {
    if (pollingStartedRef.current) return;
    pollingStartedRef.current = true;
    startPolling().catch((e) => console.warn("[market] startPolling failed:", e));
  }, [startPolling]);

  // ── Connect the engine once; subscribe to snapshots ──
  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = marketEngine.subscribe((snap) => {
      if (mountedRef.current) setSnapshot(snap);
    });
    // Start engine (WebSocket connections + finalization timer)
    // Don't pass intervals to connect — we'll use server proxy for data
    marketEngine.connect([DEFAULT_INTERVAL]);
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  // ── Feed Convex ticker data into engine ──
  useEffect(() => {
    if (!convexTickers || convexTickers.length === 0) {
      // Convex data not ready yet — try browser-side fallback
      browserFetchTickers();
      return;
    }
    for (const t of convexTickers) {
      marketEngine.ingestServerTicker({
        symbol: t.symbol,
        price: t.price,
        change24hPercent: t.change24hPercent,
        high24h: t.high24h,
        low24h: t.low24h,
        volume24h: t.volume24h,
        open24h: t.open24h,
        lastUpdate: t.lastUpdate,
      });
    }
    marketEngine.markServerConnected();
  }, [convexTickers]);

  // ── Feed Convex candle data into engine ──
  const candleFeedKey = useMemo(() => {
    if (!convexCandles || convexCandles.length === 0) return "";
    const last = convexCandles[convexCandles.length - 1];
    return `${selectedSymbol}|${selectedInterval}|${convexCandles.length}|${last?.time}`;
  }, [convexCandles, selectedSymbol, selectedInterval]);

  const fedKeyRef = useRef("");
  useEffect(() => {
    if (!candleFeedKey || candleFeedKey === fedKeyRef.current) return;
    if (!convexCandles || convexCandles.length === 0) {
      // Convex candles not ready — try browser-side fallback
      browserFetchCandles(selectedSymbol, selectedInterval);
      return;
    }
    fedKeyRef.current = candleFeedKey;
    marketEngine.ingestServerCandles(
      selectedSymbol,
      selectedInterval,
      convexCandles.map((c) => ({
        time: c.time as number,
        open: c.open as number,
        high: c.high as number,
        low: c.low as number,
        close: c.close as number,
        volume: c.volume as number,
        closed: c.closed as boolean,
      })),
    );
  }, [candleFeedKey, convexCandles, selectedSymbol, selectedInterval]);

  // ── Also try browser-side candle fetch for initial load ──
  useEffect(() => {
    // Give Convex 3 seconds, then fall back to browser-side fetch
    const timer = setTimeout(() => {
      const candles = marketEngine.getCandles(selectedSymbol, selectedInterval);
      if (candles.length === 0) {
        browserFetchCandles(selectedSymbol, selectedInterval);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [selectedSymbol, selectedInterval]);

  // ── Periodic browser-side ticker fallback ──
  useEffect(() => {
    const interval = setInterval(() => {
      // If no server data in 15 seconds, try browser-side
      const diag = marketEngine.getDiagnostics();
      if (diag.realtimeUpdatesReceived === 0 || Date.now() - (snapshot?.lastUpdate ?? 0) > 15_000) {
        browserFetchTickers();
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [snapshot?.lastUpdate]);

  // ── Recompute liveness age once per second ──
  useEffect(() => {
    const t = setInterval(() => {
      const last = snapshot?.lastUpdate ?? 0;
      setTickAgeMs(last > 0 ? Date.now() - last : 0);
    }, 1000);
    return () => clearInterval(t);
  }, [snapshot?.lastUpdate]);

  // ── Build MarketData[] from engine snapshot ──
  const data: MarketData[] = useMemo(() => {
    if (!snapshot) return [];
    return PAIRS.map((p) => {
      const s = snapshot.symbols[p.exchange];
      const price = s?.price ?? 0;
      const chg = s?.change24hPercent ?? 0;
      return {
        symbol: p.symbol,
        name: displayName(p.symbol),
        price,
        change24h: (price * chg) / 100,
        change24hPercent: chg,
        volume: s?.volume24h ?? 0,
        marketCap: 0,
        high24h: s?.high24h ?? 0,
        low24h: s?.low24h ?? 0,
        open: s?.open24h ?? 0,
        previousClose: s?.open24h ?? 0,
        candles: [],
        lastUpdated: s?.lastTickTime ?? 0,
        source: snapshot.activeProvider,
      };
    });
  }, [snapshot]);

  const getPairData = useCallback(
    (symbol: string) => data.find((d) => d.symbol === symbol),
    [data],
  );

  const candlesFor = useCallback(
    (symbol: string, interval: Interval): Candle[] => {
      const exchange = PAIRS.find((p) => p.symbol === symbol)?.exchange ?? symbol;
      return marketEngine.getCandles(exchange, interval);
    },
    [snapshot], // Re-create when snapshot changes so candles are fresh
  );

  const setIntervalSafe = useCallback((interval: Interval) => {
    setSelectedInterval(interval);
    fedKeyRef.current = ""; // reset dedup
    marketEngine.changeIntervals([interval]);
  }, []);

  const refresh = useCallback(() => {
    fedKeyRef.current = "";
    browserFetchTickers();
    browserFetchCandles(selectedSymbol, selectedInterval);
    marketEngine.changeIntervals([selectedInterval]);
  }, [selectedSymbol, selectedInterval]);

  const loading = !snapshot || data.every((d) => d.price === 0);
  const error: string | null =
    snapshot && snapshot.feedHealth === "error" ? "Market feed disconnected — retrying" : null;

  return {
    data,
    loading,
    error,
    lastFetch: snapshot?.lastUpdate ?? null,
    refresh,
    getPairData,
    dataSource: snapshot ? `WebSocket · ${snapshot.activeProvider}` : "connecting",
    feedHealth: snapshot?.feedHealth ?? "connecting",
    activeProvider: snapshot?.activeProvider ?? "—",
    candlesFor,
    selectedInterval,
    setInterval: setIntervalSafe,
    tickAgeMs,
    diagnosticsDetail: snapshot?.diagnosticsDetail ?? {
      wsConnected: false,
      wsUrl: "",
      wsReconnects: 0,
      lastWsMessageAge: 0,
      restPollActive: false,
      lastRestPollTime: 0,
      restPollErrors: 0,
      historicalCandlesLoaded: 0,
      realtimeUpdatesReceived: 0,
      symbolsWithData: 0,
      lastSeedAttempt: 0,
      seedErrors: 0,
    },
  };
}
