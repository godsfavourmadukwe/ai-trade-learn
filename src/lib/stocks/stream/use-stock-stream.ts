// ============================================================
// STOCK STREAM — React hook + public API
//
// Two genuine provider paths feed the same UI state:
//
//   1. BACKEND RELAY (authoritative): a Convex Node action
//      holds the Yahoo streamer WebSocket server-side, writes
//      normalized ticks into the stockStream table; this hook
//      subscribes with useQuery, so every server update reaches
//      React automatically — no page refresh, no polling.
//
//   2. BROWSER SOCKET (secondary): the client-side streamer
//      engine connects directly to Yahoo for lowest latency.
//      Whichever path delivers a tick first wins; both are the
//      same provider data, and candle/volume application is
//      idempotent (cumulative-volume deltas), so duplicate
//      delivery is harmless.
//
// REST history seeds the chart immediately, then live ticks
// update it. Every state write uses FRESH array/object
// references so React re-renders and the canvas redraws.
// ============================================================

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { Candle, Interval } from "@/lib/market/types";
import { fetchStockQuoteAndCandles, fetchStockFundamentals } from "@/lib/stocks/data-engine";
import type { StockQuote, FundamentalData } from "@/lib/stocks/data-engine";
import { api } from "@/convex/_generated/api";
import { stockStreamEngine, type StreamHealth } from "./engine";
import { type StreamInterval } from "./candles";
import { applyLiveQuote, type LiveQuotePatch } from "./quote-merge";
import { combineStreamHealth, type StockStreamRow } from "./health";

export type { StreamHealth, StreamStatus } from "./engine";
export { combineStreamHealth } from "./health";
export type { StockStreamRow } from "./health";

export interface StockStreamState {
  quote: StockQuote | null;
  candles: Candle[];
  fundamentals: FundamentalData | null;
  loading: boolean;
  error: string | null;
  /** Combined watchdog health across BOTH tick sources. */
  health: StreamHealth;
  /** Browser-socket health alone (debug panel distinguishes the paths). */
  clientHealth: StreamHealth | null;
  /** Raw backend relay row (diagnostics / debug panel). */
  backend: StockStreamRow | null;
  /** Epoch ms when the frontend last applied provider data. */
  lastFrontendUpdate: number;
  /** Reload historical data for the current symbol/interval. */
  refresh: () => void;
}

/**
 * Live stock data for one selected symbol + interval.
 * REST history loads immediately; both live paths then keep it fresh.
 */
export function useStockStream(
  symbol: string,
  interval: Interval,
  refreshMs = 1000,
): StockStreamState {
  const sym = symbol.toUpperCase();

  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [fundamentals, setFundamentals] = useState<FundamentalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientHealth, setClientHealth] = useState<StreamHealth | null>(null);
  const [lastFrontendUpdate, setLastFrontendUpdate] = useState(0);

  const requestRef = useRef(0);
  const symbolRef = useRef(sym);
  const intervalRef = useRef(interval);
  const appliedBackendAtRef = useRef(0);
  symbolRef.current = sym;
  intervalRef.current = interval;

  // ── Backend relay (reactive — no polling, no refresh) ──
  const backendRow = useQuery(api.stockStreamStore.get, { symbol: sym });
  const ensureStream = useAction(api.stockStream.ensure);
  const stopStream = useMutation(api.stockStreamStore.stop);

  /**
   * Apply one provider tick from EITHER source.
   * Guarded against symbol bleed; every state write creates a
   * fresh reference so the chart redraws immediately.
   */
  const applyProviderPatch = useCallback((patch: LiveQuotePatch) => {
    if (patch.symbol.toUpperCase() !== symbolRef.current) return;
    if (!Number.isFinite(patch.price) || patch.price <= 0) return;

    // 1. Quote (pure merge; keeps REST values for missing fields)
    setQuote((prev) => applyLiveQuote(prev, patch));

    // 2. Candles (idempotent via cumulative-volume deltas)
    const agg = stockStreamEngine.candles;
    if (patch.dayVolume != null) {
      agg.applyCumulativeTick(patch.symbol, patch.price, patch.time, patch.dayVolume);
    } else {
      agg.applyTick(patch.symbol, patch.price, patch.time, 0);
    }
    agg.closeCandlesBefore(patch.symbol, patch.time);

    // 3. Fresh array reference → React re-renders → canvas redraws
    setCandles(agg.getCandles(symbolRef.current, toStreamInterval(intervalRef.current)));

    // 4. Frontend processing timestamp (debug panel)
    setLastFrontendUpdate(Date.now());
  }, []);

  // ── Path 2: browser WebSocket engine ───────────────────
  useEffect(() => {
    let cancelled = false;
    const s = sym;

    stockStreamEngine.start([s], {
      onHealth: (h) => {
        if (!cancelled) setClientHealth({ ...h });
      },
      onTick: (tick) => {
        if (cancelled) return;
        if (tick.id.toUpperCase() !== s) return; // old-symbol guard
        applyProviderPatch({
          symbol: tick.id,
          price: tick.price,
          time: tick.time,
          change: tick.change,
          changePercent: tick.changePercent,
          dayHigh: tick.dayHigh,
          dayLow: tick.dayLow,
          open: tick.openPrice,
          previousClose: tick.previousClose,
          dayVolume: tick.dayVolume,
          bid: tick.bid,
          ask: tick.ask,
          feedDelayMs: tick.time > 0 ? Math.max(0, Date.now() - tick.time) : 0,
        });
      },
    });

    return () => {
      cancelled = true;
      stockStreamEngine.stop();
    };
  }, [sym, applyProviderPatch]);

  // ── Path 1: backend relay lifecycle ────────────────────
  // ensure() marks the symbol desired + starts the relay if needed.
  // Re-running it every 60s renews the relay's lease (it exits after
  // 150s without renewal, so a closed browser never leaves a zombie
  // relay) AND restarts it if it ever died while we were watching.
  useEffect(() => {
    const s = sym;
    ensureStream({ symbol: s }).catch((e) =>
      console.warn("[stock-stream] ensure failed (client path still active):", e),
    );
    const renewal = setInterval(() => {
      ensureStream({ symbol: s }).catch(() => undefined);
    }, 60_000);
    return () => {
      clearInterval(renewal);
      stopStream({ symbol: s }).catch(() => undefined);
    };
  }, [sym, ensureStream, stopStream]);

  // ── Backend row → UI state (every server update) ───────
  useEffect(() => {
    appliedBackendAtRef.current = 0; // reset per selected symbol
  }, [sym]);

  useEffect(() => {
    if (!backendRow || backendRow.symbol !== sym) return;
    const at = backendRow.receivedAt ?? 0;
    if (at <= 0 || !backendRow.price || at <= appliedBackendAtRef.current) return;
    appliedBackendAtRef.current = at;
    applyProviderPatch({
      symbol: backendRow.symbol,
      price: backendRow.price,
      time: backendRow.providerTime ?? at,
      change: backendRow.change,
      changePercent: backendRow.changePercent,
      dayHigh: backendRow.dayHigh,
      dayLow: backendRow.dayLow,
      open: backendRow.open,
      previousClose: backendRow.previousClose,
      dayVolume: backendRow.dayVolume,
      bid: backendRow.bid,
      ask: backendRow.ask,
      feedDelayMs: backendRow.feedDelayMs,
    });
  }, [backendRow, sym, applyProviderPatch]);

  // ── REST history load (initial chart + quote) ──────────
  const loadHistory = useCallback(async () => {
    const requestId = ++requestRef.current;
    const s = symbolRef.current;
    const iv = intervalRef.current;
    setLoading(true);
    setError(null);
    try {
      const { quote: q, candles: c } = await fetchStockQuoteAndCandles(s, iv, 200);
      if (requestId !== requestRef.current) return; // a newer load superseded this one
      if (!q) {
        setError(
          `Could not load data for "${s}". The symbol may be invalid, delisted, or the data service may be temporarily unavailable.`,
        );
        setLoading(false);
        return;
      }
      setQuote(q);
      setFundamentals((prev) => (prev?.symbol === q.symbol ? prev : null));

      // Seed the selected interval from REST, then show it
      const streamIv = toStreamInterval(iv);
      stockStreamEngine.candles.seed(s, streamIv, c);
      setCandles(stockStreamEngine.candles.getCandles(s, streamIv));
      setLoading(false);

      // Fundamentals enrich the analysis panel asynchronously
      fetchStockFundamentals(s)
        .then((f) => {
          if (requestId === requestRef.current && f) setFundamentals(f);
        })
        .catch(() => {
          /* fundamentals are optional enrichment */
        });
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [symbol, interval, loadHistory]);

  // ── Periodic view refresh (picks up in-place candle mutations)
  useEffect(() => {
    const t = setInterval(() => {
      setCandles(
        stockStreamEngine.candles.getCandles(
          symbolRef.current,
          toStreamInterval(intervalRef.current),
        ),
      );
    }, refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);

  const refresh = useCallback(() => {
    void loadHistory();
  }, [loadHistory]);

  const health = useMemo(
    () => combineStreamHealth(clientHealth, backendRow, sym, Date.now()),
    [clientHealth, backendRow, sym],
  );

  return {
    quote,
    candles,
    fundamentals,
    loading,
    error,
    health,
    clientHealth,
    backend: backendRow ?? null,
    lastFrontendUpdate,
    refresh,
  };
}

/** Map a UI Interval to a stream interval (identical names; 4h falls back to 1h). */
export function toStreamInterval(iv: Interval): StreamInterval {
  return iv === "4h" ? "1h" : (iv as StreamInterval);
}

export type { StreamInterval };
