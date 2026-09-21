// ============================================================
// STOCK STREAM — React hook + public API
//
// Wires the streaming engine to React state:
//   REST historical candles → seed chart immediately
//                          → live stream appends/updates
//   symbol switch          → fresh socket subscribing to the new
//                            symbol, history reload, live resumes
//   interval switch        → re-seed that interval from REST,
//                            live ticks keep updating it
// ============================================================

import { useEffect, useRef, useState, useCallback } from "react";
import type { Candle, Interval } from "@/lib/market/types";
import { fetchStockQuoteAndCandles, fetchStockFundamentals } from "@/lib/stocks/data-engine";
import type { StockQuote, FundamentalData } from "@/lib/stocks/data-engine";
import { stockStreamEngine, type StreamHealth } from "./engine";
import { type StreamInterval } from "./candles";

export type { StreamHealth } from "./engine";

export interface StockStreamState {
  quote: StockQuote | null;
  candles: Candle[];
  fundamentals: FundamentalData | null;
  loading: boolean;
  error: string | null;
  health: StreamHealth | null;
  /** Reload historical data for the current symbol/interval. */
  refresh: () => void;
}

/**
 * Live stock data for one selected symbol + interval.
 * Loads REST history immediately, then keeps the chart live via
 * the Yahoo streamer WebSocket. Candle re-renders are throttled
 * (1s cadence) instead of per tick.
 */
export function useStockStream(
  symbol: string,
  interval: Interval,
  refreshMs = 1000,
): StockStreamState {
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [fundamentals, setFundamentals] = useState<FundamentalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<StreamHealth | null>(null);

  const requestRef = useRef(0);
  const symbolRef = useRef(symbol);
  const intervalRef = useRef(interval);
  symbolRef.current = symbol;
  intervalRef.current = interval;

  // Stream lifecycle — subscribe to the selected symbol
  useEffect(() => {
    let cancelled = false;
    const sym = symbol.toUpperCase();

    stockStreamEngine.start([sym], {
      onHealth: (h) => setHealth({ ...h }),
      onTick: (tick) => {
        if (tick.id.toUpperCase() !== sym || cancelled) return;
        setQuote((prev) =>
          prev
            ? {
                ...prev,
                price: tick.price,
                change: tick.change ?? prev.change,
                changePercent: tick.changePercent ?? prev.changePercent,
                high24h: Math.max(prev.high24h, tick.dayHigh ?? tick.price),
                low24h:
                  prev.low24h > 0
                    ? Math.min(prev.low24h, tick.dayLow ?? tick.price)
                    : (tick.dayLow ?? tick.price),
                volume: tick.dayVolume ?? prev.volume,
                lastUpdate: tick.time,
                dataStatus: "live",
              }
            : prev,
        );
      },
      onCandles: (tickedSymbol) => {
        if (tickedSymbol.toUpperCase() !== sym) return;
        const view = stockStreamEngine.candles.getCandles(
          sym,
          toStreamInterval(intervalRef.current),
        );
        setCandles(view);
      },
    });

    return () => {
      cancelled = true;
      stockStreamEngine.stop();
    };
  }, [symbol]);

  // Historical load — runs on symbol or interval change
  const loadHistory = useCallback(async () => {
    const requestId = ++requestRef.current;
    const sym = symbolRef.current;
    const iv = intervalRef.current;
    setLoading(true);
    setError(null);
    try {
      const { quote: q, candles: c } = await fetchStockQuoteAndCandles(sym, iv, 200);
      if (requestId !== requestRef.current) return; // a newer load superseded this one
      if (!q) {
        setError(
          `Could not load data for "${sym}". The symbol may be invalid, delisted, or the data service may be temporarily unavailable.`,
        );
        setLoading(false);
        return;
      }
      setQuote(q);
      setFundamentals((prev) => (prev?.symbol === q.symbol ? prev : null));

      // Seed the selected interval from REST, then show it
      const streamIv = toStreamInterval(iv);
      stockStreamEngine.candles.seed(sym.toUpperCase(), streamIv, c);
      setCandles(stockStreamEngine.candles.getCandles(sym.toUpperCase(), streamIv));
      setLoading(false);

      // Fundamentals enrich the analysis panel asynchronously
      fetchStockFundamentals(sym)
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

  // Throttled candle view refresh while live
  useEffect(() => {
    const t = setInterval(() => {
      const sym = symbolRef.current.toUpperCase();
      const iv = toStreamInterval(intervalRef.current);
      setCandles(stockStreamEngine.candles.getCandles(sym, iv));
    }, refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);

  const refresh = useCallback(() => {
    void loadHistory();
  }, [loadHistory]);

  return { quote, candles, fundamentals, loading, error, health, refresh };
}

const SHARED_VIEW_INTERVAL: StreamInterval = "1m";

/** Map a UI Interval to a stream interval (identical names; 4h falls back to 1h). */
export function toStreamInterval(iv: Interval): StreamInterval {
  return iv === "4h" ? "1h" : (iv as StreamInterval);
}

export type { StreamInterval };
