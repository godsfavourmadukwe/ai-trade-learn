import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { marketEngine, type EngineSnapshot, type EngineDiagnosticsDetail } from "@/lib/market/engine";
import { PAIRS, displayName } from "@/lib/market/symbols";
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

export function useMarketData(): UseMarketDataReturn {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<Interval>(DEFAULT_INTERVAL);
  const [tickAgeMs, setTickAgeMs] = useState(0);
  const mountedRef = useRef(true);

  // ── Convex server-side data subscriptions ──
  const convexTickers = useQuery(api.marketProxy.getTickers);
  const convexCandlesBtc = useQuery(api.marketProxy.getCandles, { symbol: "BTCUSDT", interval: selectedInterval });
  const convexCandlesEth = useQuery(api.marketProxy.getCandles, { symbol: "ETHUSDT", interval: selectedInterval });
  const convexCandlesSol = useQuery(api.marketProxy.getCandles, { symbol: "SOLUSDT", interval: selectedInterval });
  const convexCandlesBnb = useQuery(api.marketProxy.getCandles, { symbol: "BNBUSDT", interval: selectedInterval });
  const convexCandlesXrp = useQuery(api.marketProxy.getCandles, { symbol: "XRPUSDT", interval: selectedInterval });
  const convexCandlesAda = useQuery(api.marketProxy.getCandles, { symbol: "ADAUSDT", interval: selectedInterval });
  const convexCandlesDoge = useQuery(api.marketProxy.getCandles, { symbol: "DOGEUSDT", interval: selectedInterval });
  const convexCandlesAvax = useQuery(api.marketProxy.getCandles, { symbol: "AVAXUSDT", interval: selectedInterval });
  const convexCandlesDot = useQuery(api.marketProxy.getCandles, { symbol: "DOTUSDT", interval: selectedInterval });
  const convexCandlesLink = useQuery(api.marketProxy.getCandles, { symbol: "LINKUSDT", interval: selectedInterval });

  const startPolling = useAction(api.marketProxy.startPolling);
  const pollingStartedRef = useRef(false);

  // ── Start server-side polling on mount ──
  useEffect(() => {
    if (pollingStartedRef.current) return;
    pollingStartedRef.current = true;
    // Fire-and-forget: start the server-side polling loop
    startPolling().catch((e) => console.warn("[market] startPolling failed:", e));
  }, [startPolling]);

  // ── Connect the engine once per app lifetime; subscribe to snapshots ──
  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = marketEngine.subscribe((snap) => {
      if (mountedRef.current) setSnapshot(snap);
    });
    marketEngine.connect([DEFAULT_INTERVAL]);
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  // ── Feed Convex ticker data into engine ──
  useEffect(() => {
    if (!convexTickers || convexTickers.length === 0) return;
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
  const candleMap: Record<string, typeof convexCandlesBtc> = useMemo(() => ({
    BTCUSDT: convexCandlesBtc,
    ETHUSDT: convexCandlesEth,
    SOLUSDT: convexCandlesSol,
    BNBUSDT: convexCandlesBnb,
    XRPUSDT: convexCandlesXrp,
    ADAUSDT: convexCandlesAda,
    DOGEUSDT: convexCandlesDoge,
    AVAXUSDT: convexCandlesAvax,
    DOTUSDT: convexCandlesDot,
    LINKUSDT: convexCandlesLink,
  }), [convexCandlesBtc, convexCandlesEth, convexCandlesSol, convexCandlesBnb, convexCandlesXrp, convexCandlesAda, convexCandlesDoge, convexCandlesAvax, convexCandlesDot, convexCandlesLink]);

  // Feed candles into engine for each symbol
  const fedCandlesRef = useRef(new Set<string>());
  useEffect(() => {
    for (const symbol of Object.keys(candleMap)) {
      const candles = candleMap[symbol];
      if (!candles || candles.length === 0) continue;
      const feedKey = `${symbol}|${selectedInterval}|${candles.length}|${candles[candles.length - 1]?.time}`;
      if (fedCandlesRef.current.has(feedKey)) continue;
      fedCandlesRef.current.add(feedKey);
      marketEngine.ingestServerCandles(
        symbol,
        selectedInterval,
        candles.map((c) => ({
          time: c.time as number,
          open: c.open as number,
          high: c.high as number,
          low: c.low as number,
          close: c.close as number,
          volume: c.volume as number,
          closed: c.closed as boolean,
        })),
      );
    }
  }, [candleMap, selectedInterval]);

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
    [],
  );

  const setIntervalSafe = useCallback((interval: Interval) => {
    setSelectedInterval(interval);
    marketEngine.changeIntervals([interval]);
    fedCandlesRef.current.clear(); // reset dedup so new interval candles get fed
  }, []);

  const refresh = useCallback(() => {
    fedCandlesRef.current.clear();
    marketEngine.changeIntervals([selectedInterval]);
  }, [selectedInterval]);

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
