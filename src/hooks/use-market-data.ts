import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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

  // Connect the engine once per app lifetime; subscribe to snapshots.
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

  // Recompute a liveness "age" once per second so the UI can show staleness
  // without re-rendering on every tick.
  useEffect(() => {
    const t = setInterval(() => {
      const last = snapshot?.lastUpdate ?? 0;
      setTickAgeMs(last > 0 ? Date.now() - last : 0);
    }, 1000);
    return () => clearInterval(t);
  }, [snapshot?.lastUpdate]);

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
  }, []);

  const refresh = useCallback(() => {
    // Re-run the same seed/backfill path used for recovery.
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
  };
}
