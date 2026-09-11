// ============================================================
// AI TRADE ARENA — condition gating + data health
// Default decision is NO_TRADE. A signal is only allowed when
// the market data feeding the arena is sufficiently fresh and
// complete.
// ============================================================

import type {
  ArenaDataHealth,
  ArenaInstrument,
  TradeSide,
  ArenaTimeframe,
  TradeExitReason,
} from "./types";

/** Thresholds for data freshness used across the arena. */
export const ARENA_DATA_THRESHOLDS = {
  maxTickAgeMs: 25_000, // if no tick for this long, treat pair as stale
  maxCandleAgeMs: 2 * 60 * 60 * 1000, // 2h for 1h timeframe fallback; per-pair overrides below
  maxGapSize: 2, // tolerate at most this many missing boundaries before flagging gaps
} as const;

/** Per-timeframe max candle age before a timeframe is considered stale. */
export function maxCandleAgeFor(timeframe: ArenaTimeframe): number {
  const msPerBar: Record<ArenaTimeframe, number> = {
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
  };
  // Allow up to ~3 closed bars plus a small buffer.
  return Math.round((msPerBar[timeframe] * 3.25) / 1000) * 1000;
}

/** Data health snapshot computed from the market engine state. */
export interface DataHealthInput {
  feedHealth: ArenaDataHealth["feedHealth"];
  provider: string;
  lastTickMsAgo: number;
  lastCandleMsAgo: number;
  hasGaps: boolean;
  exchange: string;
}

export function computeDataHealth(input: DataHealthInput): ArenaDataHealth {
  const { feedHealth, provider, lastTickMsAgo, lastCandleMsAgo, hasGaps, exchange } = input;
  const stale =
    feedHealth === "error" ||
    feedHealth === "stale" ||
    lastTickMsAgo > ARENA_DATA_THRESHOLDS.maxTickAgeMs ||
    lastCandleMsAgo > maxCandleAgeFor("1h") ||
    hasGaps;
  const health: ArenaDataHealth = {
    feedHealth,
    lastTickMsAgo,
    lastCandleAgeMsAgo: lastCandleMsAgo,
    hasGaps,
    provider,
  };
  return health;
}

/** Whether new arena decisions are allowed given data health. */
export function isDataAcceptable(health: ArenaDataHealth): boolean {
  if (health.feedHealth === "error") return false;
  if (health.feedHealth === "stale") return false;
  if (health.lastTickMsAgo > ARENA_DATA_THRESHOLDS.maxTickAgeMs) return false;
  if (health.lastCandleAgeMsAgo > maxCandleAgeFor("1h")) return false;
  if (health.hasGaps) return false;
  return true;
}

/** Generic readiness conditions required before any arena signal is accepted. */
export interface ReadinessContext {
  instrument: ArenaInstrument;
  currentPrice: number;
  side: TradeSide;
  timeframe: ArenaTimeframe;
  health: ArenaDataHealth;
  spreadPercent: number;
  /** Estimated bid/ask spread relative to price. */
  spreadBps: number;
  /** Estimated 24h quote volume in quote currency. */
  volume24hQuote: number;
  /** Minimum acceptable 24h quote volume. */
  minVolume24hQuote: number;
  /** Minimum acceptable price for the pair. */
  minPrice: number;
  /** Maximum acceptable price for the pair. */
  maxPrice: number;
  /** If true, longs are not allowed. */
  longsBlocked: boolean;
  /** If true, shorts are not allowed. */
  shortsBlocked: boolean;
  /** Model paused state. */
  modelPaused: boolean;
  /** If true, no new decisions at all. */
  globalKillSwitch: boolean;
}

export interface ReadinessResult {
  ready: boolean;
  failedChecks: string[];
}

export function checkReadiness(ctx: ReadinessContext): ReadinessResult {
  const failed: string[] = [];

  if (ctx.globalKillSwitch) {
    failed.push("global_kill_switch");
  }
  if (ctx.modelPaused) {
    failed.push("model_paused");
  }
  if (!ctx.instrument.tradable) {
    failed.push("instrument_not_tradable");
  }
  if (ctx.instrument.status !== "online") {
    failed.push("instrument_offline");
  }
  if (ctx.currentPrice <= 0) {
    failed.push("invalid_price");
  }
  if (ctx.currentPrice < ctx.minPrice || ctx.currentPrice > ctx.maxPrice) {
    failed.push("price_out_of_bounds");
  }
  if (ctx.side === "long" && ctx.longsBlocked) {
    failed.push("longs_blocked");
  }
  if (ctx.side === "short" && ctx.shortsBlocked) {
    failed.push("shorts_blocked");
  }
  if (!isDataAcceptable(ctx.health)) {
    failed.push("data_not_fresh");
  }
  if (ctx.spreadBps > 50) {
    // 50 bps is a conservative default; providers can tighten per pair.
    failed.push("spread_unacceptable");
  }
  if (ctx.volume24hQuote < ctx.minVolume24hQuote) {
    failed.push("liquidity_low");
  }
  if (!supportedTimeframe(ctx.instrument, ctx.timeframe)) {
    failed.push("timeframe_not_supported");
  }

  return {
    ready: failed.length === 0,
    failedChecks: failed,
  };
}

export function supportedTimeframe(
  instrument: Pick<ArenaInstrument, "supportedTimeframes">,
  timeframe: ArenaTimeframe,
): boolean {
  return instrument.supportedTimeframes.includes(timeframe);
}

/** Attempt to recover a provider-native symbol from an arena symbol.
 *  This is intentionally best-effort; if it cannot be resolved, the pair is
 *  treated as unavailable rather than assumed tradable. */
export function normalizeExchangeSymbol(
  instrument: ArenaInstrument | undefined,
  arenaSymbol: string,
): string | null {
  if (!instrument) return null;
  if (instrument.exchangeSymbol.toUpperCase() === arenaSymbol.toUpperCase()) {
    return instrument.exchangeSymbol;
  }
  if (instrument.symbol.toUpperCase() === arenaSymbol.toUpperCase()) {
    return instrument.exchangeSymbol;
  }
  return null;
}

/** Build a human-readable rejection reason from failed checks. */
export function explainRejection(failedChecks: string[]): string {
  if (failedChecks.length === 0) return "No additional information.";
  return failedChecks.join("; ");
}

/** Map exit reason to a short UI label. */
export function exitReasonLabel(reason: TradeExitReason): string {
  return (
    {
      take_profit: "Take Profit",
      stop_loss: "Stop Loss",
      trailing_stop: "Trailing Stop",
      time_exit: "Time Exit",
      invalidation_exit: "Invalidation",
      manual_close: "Manual Close",
      signal_invalidated: "Invalidated",
    }[reason] ?? reason
  );
}
