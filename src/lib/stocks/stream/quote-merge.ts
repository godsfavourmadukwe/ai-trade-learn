// ============================================================
// STOCK STREAM — Live quote merge (pure function)
//
// Both live-tick sources (browser WebSocket engine and the
// backend Convex relay) normalize their ticks into a
// LiveQuotePatch and merge through this function, so the UI
// behaves identically regardless of which path delivered data.
//
// Rules:
//   • never applies a tick for a different symbol
//   • never applies an invalid price (NaN/Infinity/≤0)
//   • never invents values — missing fields keep the REST value
//   • marks dataStatus "delayed" when provider timestamps lag
// ============================================================

import type { StockQuote } from "@/lib/stocks/data-engine";

export interface LiveQuotePatch {
  symbol: string;
  price: number;
  time: number; // provider/arrival time (epoch ms)
  change?: number | null;
  changePercent?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  open?: number | null;
  previousClose?: number | null;
  dayVolume?: number | null;
  bid?: number | null;
  ask?: number | null;
  /** now - providerTime; when > 90s the data is labeled delayed. */
  feedDelayMs?: number | null;
}

const DELAYED_THRESHOLD_MS = 90_000;

/**
 * Merge one live tick into the REST-seeded quote.
 * Returns the SAME reference when nothing valid can be applied,
 * so React can skip pointless re-renders.
 */
export function applyLiveQuote(prev: StockQuote | null, patch: LiveQuotePatch): StockQuote | null {
  if (!prev) return null;
  if (prev.symbol.toUpperCase() !== patch.symbol.toUpperCase()) return prev; // cross-symbol guard
  if (!Number.isFinite(patch.price) || patch.price <= 0) return prev;
  if (!Number.isFinite(patch.time) || patch.time <= 0) return prev;

  const dayHigh = Number.isFinite(patch.dayHigh ?? NaN) ? (patch.dayHigh as number) : null;
  const dayLow = Number.isFinite(patch.dayLow ?? NaN) ? (patch.dayLow as number) : null;

  const high24h =
    dayHigh != null ? Math.max(prev.high24h || dayHigh, dayHigh) : prev.high24h;
  const low24h =
    dayLow != null
      ? prev.low24h > 0
        ? Math.min(prev.low24h, dayLow)
        : dayLow
      : prev.low24h;

  const delayed = patch.feedDelayMs != null && patch.feedDelayMs > DELAYED_THRESHOLD_MS;

  return {
    ...prev,
    price: patch.price,
    change: patch.change ?? prev.change,
    changePercent: patch.changePercent ?? prev.changePercent,
    high24h,
    low24h,
    open24h: patch.open ?? prev.open24h,
    previousClose: patch.previousClose ?? prev.previousClose,
    volume: patch.dayVolume ?? prev.volume,
    bid: patch.bid ?? prev.bid ?? null,
    ask: patch.ask ?? prev.ask ?? null,
    lastUpdate: patch.time,
    dataStatus: delayed ? "delayed" : "live",
  };
}
