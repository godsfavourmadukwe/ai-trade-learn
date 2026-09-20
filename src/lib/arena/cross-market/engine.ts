// ============================================================
// AI TRADE ARENA — Cross-Market Context Engine (pure analysis)
//
// Determines whether broader market conditions CONFIRM,
// CONTRADICT or are NEUTRAL to a pair's setup using ONLY data
// available from the existing market-data providers.
//
// Factors:
//  1. Correlated-asset alignment (returns correlation, weighted)
//  2. Market-wide breadth (advancing ratio, dispersion)
//  3. Relative strength vs correlated peers
//  4. Cross-market volatility state
//  5. Market-wide trend (risk-on / risk-off)
//
// Produces a verdict + confidence + factors. Never forces a
// trade; the fusion engine treats CONTRADICT as veto-capable
// evidence and everything else as directional evidence.
// ============================================================

import type {
  CrossMarketInput,
  CrossMarketContext,
  CrossMarketVerdict,
  CrossMarketFactor,
  RelatedMarket,
  MarketBreadth,
  MarketVolatilityState,
  CorrelationStrength,
  FactorLean,
} from "./types";

// ── Config ─────────────────────────────────────────────────

export interface CrossMarketEngineConfig {
  /** Max related markets to analyze (by correlation rank). */
  maxRelatedMarkets: number;
  /** Minimum absolute Pearson correlation to count a market as "correlated". */
  minCorrelation: number;
  /** Minimum 24h quote volume for a universe member to be included. */
  minQuoteVolume24h: number;
  /** Minimum observations for a correlation to be trusted. */
  minReturnObservations: number;
  /** |spread| in pp above which relative strength leans. */
  relativeStrengthThresholdPp: number;
  /** Advancing-ratio bands for breadth interpretation. */
  breadthRiskOnRatio: number;
  breadthRiskOffRatio: number;
  /** Relative-vol bands vs correlated peers. */
  elevatedRelativeVol: number;
  extremeRelativeVol: number;
  /** Minimum number of universe markets for breadth to be valid. */
  minBreadthUniverse: number;
}

export const DEFAULT_CROSS_MARKET_CONFIG: CrossMarketEngineConfig = {
  maxRelatedMarkets: 8,
  minCorrelation: 0.3,
  minQuoteVolume24h: 10_000_000, // $10M — keeps analysis on liquid markets
  minReturnObservations: 24, // 24 x 1h candles
  relativeStrengthThresholdPp: 2,
  breadthRiskOnRatio: 0.6,
  breadthRiskOffRatio: 0.4,
  elevatedRelativeVol: 1.6,
  extremeRelativeVol: 2.5,
  minBreadthUniverse: 6,
};

// ── Statistics helpers ─────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Pearson correlation over the overlapping window of two return series.
 * Both series are oldest→newest. Returns null when insufficient overlap.
 */
export function pearsonCorrelation(a: number[], b: number[]): number | null {
  if (a.length < 3 || b.length < 3) return null;
  const n = Math.min(a.length, b.length);
  // Align on the most recent observations
  const xs = a.slice(a.length - n);
  const ys = b.slice(b.length - n);
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return null;
  return cov / Math.sqrt(vx * vy);
}

function correlationStrength(corr: number | null): CorrelationStrength {
  if (corr == null) return "unknown";
  const abs = Math.abs(corr);
  if (abs >= 0.7) return "strong";
  if (abs >= 0.5) return "moderate";
  if (abs >= 0.3) return "weak";
  return "unknown";
}

function returnsFromPrices(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      out.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }
  return out;
}

// ── Universe analysis ──────────────────────────────────────

interface UniverseMember {
  exchangeSymbol: string;
  symbol: string;
  price: number;
  change24hPercent: number;
  quoteVolume24h: number;
  correlation: number | null;
  volatility: number | null;
  reason: string;
}

/**
 * Analyze the universe: compute correlations, rank by them, and
 * build breadth statistics. Selection is fully dynamic — derived
 * from whatever the providers return — no hardcoded assets.
 */
function analyzeUniverse(
  input: CrossMarketInput,
  config: CrossMarketEngineConfig,
): { members: UniverseMember[]; breadth: MarketBreadth | null; excludedSelf: string } {
  const self = input.exchangeSymbol;

  // Liquid universe from provider data
  const liquid = input.universe.filter(
    (u) => u.exchangeSymbol !== self && u.quoteVolume24h >= config.minQuoteVolume24h,
  );

  // Correlation vs target for every liquid member with enough data
  const targetReturns = input.returnSeries.get(self) ?? [];
  const members: UniverseMember[] = [];
  for (const u of liquid) {
    const rets = input.returnSeries.get(u.exchangeSymbol) ?? [];
    const corr = rets.length >= config.minReturnObservations && targetReturns.length >= config.minReturnObservations
      ? pearsonCorrelation(targetReturns, rets)
      : null;
    members.push({
      ...u,
      correlation: corr,
      volatility: rets.length >= 2 ? std(rets) : null,
      reason: corr != null
        ? `${Math.abs(corr) >= 0.7 ? "strongly" : Math.abs(corr) >= 0.5 ? "moderately" : "weakly"} correlated (${corr >= 0 ? "+" : ""}${corr.toFixed(2)})`
        : "liquid universe member (no return history)",
    });
  }

  // Breadth across ALL liquid members (not just correlated ones)
  let breadth: MarketBreadth | null = null;
  if (liquid.length >= config.minBreadthUniverse) {
    const changes = liquid.map((u) => u.change24hPercent);
    const advancing = changes.filter((c) => c > 0).length;
    breadth = {
      measuredCount: liquid.length,
      advancingRatio: changes.length > 0 ? advancing / changes.length : 0.5,
      meanChange24h: mean(changes),
      medianChange24h: median(changes),
      extremeMoveRatio: changes.length > 0 ? changes.filter((c) => Math.abs(c) > 5).length / changes.length : 0,
      dispersion: std(changes),
    };
  }

  return { members, breadth, excludedSelf: self };
}

// ── Factor builders ────────────────────────────────────────

function correlatedAlignmentFactor(
  targetChange: number,
  side: "long" | "short",
  correlated: UniverseMember[],
  config: CrossMarketEngineConfig,
): CrossMarketFactor {
  if (correlated.length === 0) {
    return {
      factor: "correlated_assets",
      lean: "unavailable",
      weight: 0,
      detail: "No sufficiently correlated markets with return history were found.",
      metrics: { correlatedCount: 0 },
    };
  }

  // Correlation-weighted mean change of peers
  let wsum = 0;
  let changeSum = 0;
  for (const m of correlated) {
    const w = Math.abs(m.correlation ?? 0);
    wsum += w;
    changeSum += w * m.change24hPercent;
  }
  const peerChange = wsum > 0 ? changeSum / wsum : 0;

  const peerDir = peerChange > 0 ? "up" : "down";
  const magnitude = Math.abs(peerChange);

  // Lean is relative to the SETUP side, not the target's own move:
  // correlated markets rising confirms a long and contradicts a short.
  const peersRising = peerChange > 0;
  const setupIsLong = side === "long";
  const peerAlignedWithSetup = peersRising === setupIsLong;

  let lean: FactorLean;
  if (!peerAlignedWithSetup && magnitude >= 2) {
    lean = "contradict";
  } else if (!peerAlignedWithSetup && magnitude >= 1) {
    lean = "contradict";
  } else if (peerAlignedWithSetup && magnitude >= 1) {
    lean = "confirm";
  } else {
    lean = "neutral";
  }

  const strength = correlationStrength(
    correlated.length > 0
      ? correlated.reduce((s, m) => s + Math.abs(m.correlation ?? 0), 0) / correlated.length
      : null,
  );

  return {
    factor: "correlated_assets",
    lean,
    weight: correlated.length > 0 ? Math.min(0.35, 0.1 + correlated.length * 0.03) : 0,
    detail: `${correlated.length} correlated market${correlated.length === 1 ? "" : "s"} (avg ${strength} correlation) are ${peerDir} ${magnitude.toFixed(2)}% on average — ${peerAlignedWithSetup ? "supporting" : "opposing"} the ${side} setup.`,
    metrics: {
      correlatedCount: correlated.length,
      peerMeanChange: peerChange,
      targetChange,
      avgCorrelation:
        correlated.length > 0
          ? correlated.reduce((s, m) => s + (m.correlation ?? 0), 0) / correlated.length
          : 0,
    },
  };
}

function breadthFactor(
  breadth: MarketBreadth | null,
  side: "long" | "short",
  config: CrossMarketEngineConfig,
): CrossMarketFactor {
  if (!breadth) {
    return {
      factor: "market_breadth",
      lean: "unavailable",
      weight: 0,
      detail: "Not enough liquid markets available to compute market breadth.",
      metrics: {},
    };
  }

  const { advancingRatio, dispersion, extremeMoveRatio } = breadth;

  // Disorder check first: wild cross-sectional dispersion degrades
  // every directional setup.
  if (extremeMoveRatio > 0.35 || dispersion > 8) {
    return {
      factor: "market_breadth",
      lean: side === "long" ? "contradict" : "neutral",
      weight: 0.15,
      detail: `Disordered market: ${(extremeMoveRatio * 100).toFixed(0)}% of markets moving >5% and ${(dispersion).toFixed(1)}pp dispersion — directional signals are unreliable.`,
      metrics: { advancingRatio, dispersion, extremeMoveRatio, measuredCount: breadth.measuredCount },
    };
  }

  let lean: FactorLean;
  let detail: string;
  if (advancingRatio >= config.breadthRiskOnRatio) {
    lean = side === "long" ? "confirm" : "contradict";
    detail = `Broad market strength: ${(advancingRatio * 100).toFixed(0)}% of ${breadth.measuredCount} liquid markets advancing — risk-on backdrop.`;
  } else if (advancingRatio <= config.breadthRiskOffRatio) {
    lean = side === "short" ? "confirm" : "contradict";
    detail = `Broad market weakness: only ${(advancingRatio * 100).toFixed(0)}% of ${breadth.measuredCount} liquid markets advancing — risk-off backdrop.`;
  } else {
    lean = "neutral";
    detail = `Mixed breadth: ${(advancingRatio * 100).toFixed(0)}% of ${breadth.measuredCount} liquid markets advancing — no clear market-wide direction.`;
  }

  return {
    factor: "market_breadth",
    lean,
    weight: 0.2,
    detail,
    metrics: { advancingRatio, dispersion, extremeMoveRatio, measuredCount: breadth.measuredCount },
  };
}

function relativeStrengthFactor(
  targetChange: number,
  correlated: UniverseMember[],
  config: CrossMarketEngineConfig,
): CrossMarketFactor {
  if (correlated.length === 0) {
    return {
      factor: "relative_strength",
      lean: "unavailable",
      weight: 0,
      detail: "No correlated peers to compare relative strength.",
      metrics: {},
    };
  }

  const peerMean =
    correlated.reduce((s, m) => s + m.change24hPercent, 0) / correlated.length;
  const spread = targetChange - peerMean; // percentage points

  let lean: FactorLean;
  let detail: string;
  if (spread >= config.relativeStrengthThresholdPp) {
    lean = "confirm";
    detail = `Target is outperforming correlated peers by ${spread.toFixed(2)}pp — leader, not laggard.`;
  } else if (spread <= -config.relativeStrengthThresholdPp) {
    lean = "contradict";
    detail = `Target is underperforming correlated peers by ${Math.abs(spread).toFixed(2)}pp — laggard behavior weakens breakout setups.`;
  } else {
    lean = "neutral";
    detail = `Relative strength in line with peers (spread ${spread >= 0 ? "+" : ""}${spread.toFixed(2)}pp).`;
  }

  return {
    factor: "relative_strength",
    lean,
    weight: 0.15,
    detail,
    metrics: { spread, peerMean, targetChange },
  };
}

function volatilityFactor(
  input: CrossMarketInput,
  correlated: UniverseMember[],
  config: CrossMarketEngineConfig,
): CrossMarketFactor {
  const targetVol = input.targetVolatility;
  const vols = correlated.map((m) => m.volatility).filter((v): v is number => v != null && v > 0);

  if (targetVol <= 0 || vols.length === 0) {
    return {
      factor: "cross_volatility",
      lean: "unavailable",
      weight: 0,
      detail: "Insufficient volatility data for cross-market comparison.",
      metrics: {},
    };
  }

  const peerVol = mean(vols);
  const relativeVol = peerVol > 0 ? targetVol / peerVol : null;

  const state: MarketVolatilityState = {
    correlatedMeanVol: peerVol,
    targetVol,
    relativeVol,
    level:
      relativeVol == null
        ? "normal"
        : relativeVol >= config.extremeRelativeVol
          ? "extreme"
          : relativeVol >= config.elevatedRelativeVol
            ? "elevated"
            : relativeVol < 0.5
              ? "calm"
              : "normal",
  };

  // Idiosyncratic volatility spikes contradict setups: the pair is
  // moving on its own news/flow, not with the market.
  if (state.level === "extreme") {
    return {
      factor: "cross_volatility",
      lean: "contradict",
      weight: 0.15,
      detail: `Pair volatility is ${relativeVol?.toFixed(1)}x the correlated-market average — idiosyncratic event risk.`,
      metrics: { relativeVol: relativeVol ?? 0, targetVol, peerVol },
    };
  }
  if (state.level === "elevated") {
    return {
      factor: "cross_volatility",
      lean: "neutral",
      weight: 0.1,
      detail: `Pair volatility is ${relativeVol?.toFixed(1)}x the correlated-market average — moderately above peers.`,
      metrics: { relativeVol: relativeVol ?? 0, targetVol, peerVol },
    };
  }
  if (state.level === "calm") {
    return {
      factor: "cross_volatility",
      lean: "neutral",
      weight: 0.1,
      detail: `Pair volatility is ${relativeVol?.toFixed(1)}x the correlated-market average — unusually calm vs peers.`,
      metrics: { relativeVol: relativeVol ?? 0, targetVol, peerVol },
    };
  }
  return {
    factor: "cross_volatility",
    lean: "confirm",
    weight: 0.1,
    detail: `Pair volatility (${(targetVol * 100).toFixed(2)}%) is in line with correlated markets (${(peerVol * 100).toFixed(2)}%) — moves are market-driven.`,
    metrics: { relativeVol: relativeVol ?? 1, targetVol, peerVol },
  };
}

function marketTrendFactor(
  breadth: MarketBreadth | null,
  side: "long" | "short",
  config: CrossMarketEngineConfig,
): CrossMarketFactor {
  if (!breadth) {
    return {
      factor: "market_trend",
      lean: "unavailable",
      weight: 0,
      detail: "No universe data to derive a market-wide trend.",
      metrics: {},
    };
  }

  const { meanChange24h, medianChange24h } = breadth;

  let trend: "risk_on" | "risk_off" | "mixed";
  if (meanChange24h >= 1 && medianChange24h >= 0.5) trend = "risk_on";
  else if (meanChange24h <= -1 && medianChange24h <= -0.5) trend = "risk_off";
  else trend = "mixed";

  if (trend === "mixed") {
    return {
      factor: "market_trend",
      lean: "neutral",
      weight: 0.1,
      detail: `Market-wide 24h mean ${meanChange24h >= 0 ? "+" : ""}${meanChange24h.toFixed(2)}% / median ${medianChange24h.toFixed(2)}% — no dominant trend.`,
      metrics: { meanChange24h, medianChange24h, measuredCount: breadth.measuredCount },
    };
  }

  const setupIsLong = side === "long";
  const trendIsUp = trend === "risk_on";
  const aligned = setupIsLong === trendIsUp;

  return {
    factor: "market_trend",
    lean: aligned ? "confirm" : "contradict",
    weight: 0.15,
    detail: `Market-wide ${trend === "risk_on" ? "risk-on" : "risk-off"} drift (mean ${meanChange24h >= 0 ? "+" : ""}${meanChange24h.toFixed(2)}%, median ${medianChange24h.toFixed(2)}%) is ${aligned ? "aligned" : "opposed"} to the ${side} setup.`,
    metrics: { meanChange24h, medianChange24h, measuredCount: breadth.measuredCount },
  };
}

// ── Verdict assembly ───────────────────────────────────────

function verdictFromFactors(
  factors: CrossMarketFactor[],
  dataAvailable: boolean,
): { verdict: CrossMarketVerdict; score: number; strength: number; confidence: number } {
  if (!dataAvailable) {
    return { verdict: "insufficient_data", score: 0, strength: 0, confidence: 0 };
  }

  const usable = factors.filter((f) => f.lean === "confirm" || f.lean === "contradict");
  if (usable.length === 0) {
    return { verdict: "neutral", score: 0, strength: 0, confidence: 0.3 };
  }

  let score = 0;
  let weightSum = 0;
  for (const f of factors) {
    if (f.lean === "confirm") score += f.weight;
    else if (f.lean === "contradict") score -= f.weight;
    weightSum += f.weight;
  }

  const magnitude = weightSum > 0 ? Math.abs(score) / weightSum : 0;
  let verdict: CrossMarketVerdict;
  if (magnitude >= 0.4) verdict = score > 0 ? "confirm" : "contradict";
  else if (magnitude >= 0.2) verdict = score > 0 ? "confirm" : "contradict";
  else verdict = "neutral";

  const confidence = Math.min(0.9, 0.35 + usable.length * 0.12 + magnitude * 0.3);
  return { verdict, score, strength: magnitude, confidence };
}

// ── Public pure API ────────────────────────────────────────

/**
 * Compute the cross-market context for one pair from provider data.
 * Pure function: no fetches, no globals. Returns a full
 * CrossMarketContext with verdict, factors, related markets and metrics.
 */
export function computeCrossMarketContext(
  input: CrossMarketInput,
  config: Partial<CrossMarketEngineConfig> = {},
): CrossMarketContext {
  const cfg = { ...DEFAULT_CROSS_MARKET_CONFIG, ...config };

  const selfTicker = input.universe.find((u) => u.exchangeSymbol === input.exchangeSymbol) ?? null;
  const targetChange = selfTicker?.change24hPercent ?? 0;
  const dataAvailable = selfTicker != null && input.universe.length >= 2;

  const { members, breadth } = analyzeUniverse(input, cfg);

  // Correlated set: |corr| >= minCorrelation, ranked by |corr|
  const correlated = members
    .filter((m) => m.correlation != null && Math.abs(m.correlation) >= cfg.minCorrelation)
    .sort((a, b) => Math.abs(b.correlation ?? 0) - Math.abs(a.correlation ?? 0))
    .slice(0, cfg.maxRelatedMarkets);

  const relatedMarkets: RelatedMarket[] = correlated.map((m) => ({
    exchangeSymbol: m.exchangeSymbol,
    symbol: m.symbol,
    reason: m.reason,
    correlation: m.correlation,
    change24hPercent: m.change24hPercent,
    quoteVolume24h: m.quoteVolume24h,
    volatility: m.volatility,
  }));

  // Factors
  const factors: CrossMarketFactor[] = [
    correlatedAlignmentFactor(targetChange, input.side, correlated, cfg),
    breadthFactor(breadth, input.side, cfg),
    relativeStrengthFactor(targetChange, correlated, cfg),
    volatilityFactor(input, correlated, cfg),
    marketTrendFactor(breadth, input.side, cfg),
  ];

  const { verdict, score, strength, confidence } = verdictFromFactors(factors, dataAvailable);

  // Market trend classification
  let marketTrend: CrossMarketContext["marketTrend"] = "unknown";
  if (breadth) {
    if (breadth.meanChange24h >= 1 && breadth.medianChange24h >= 0.5) marketTrend = "risk_on";
    else if (breadth.meanChange24h <= -1 && breadth.medianChange24h <= -0.5) marketTrend = "risk_off";
    else marketTrend = "mixed";
  }

  // Volatility state for the context object
  const vols = correlated.map((m) => m.volatility).filter((v): v is number => v != null && v > 0);
  const peerVol = vols.length > 0 ? mean(vols) : null;
  const relativeVol = peerVol && input.targetVolatility > 0 ? input.targetVolatility / peerVol : null;
  const volatility: MarketVolatilityState | null = peerVol != null
    ? {
        correlatedMeanVol: peerVol,
        targetVol: input.targetVolatility,
        relativeVol,
        level:
          relativeVol == null
            ? "normal"
            : relativeVol >= cfg.extremeRelativeVol
              ? "extreme"
              : relativeVol >= cfg.elevatedRelativeVol
                ? "elevated"
                : relativeVol < 0.5
                  ? "calm"
                  : "normal",
      }
    : null;

  // Summary
  let summary: string;
  if (!dataAvailable) {
    summary = `Cross-market context unavailable for ${input.symbol}: insufficient provider data.`;
  } else if (verdict === "insufficient_data") {
    summary = `Cross-market context inconclusive for ${input.symbol}: no correlated markets with return history.`;
  } else {
    const confirmCount = factors.filter((f) => f.lean === "confirm").length;
    const contradictCount = factors.filter((f) => f.lean === "contradict").length;
    const neutralCount = factors.filter((f) => f.lean === "neutral").length;
    summary =
      verdict === "confirm"
        ? `Cross-market context CONFIRMS the ${input.side} setup on ${input.symbol}: ${confirmCount} factor(s) support (${correlated.length} correlated markets, breadth ${breadth ? `${(breadth.advancingRatio * 100).toFixed(0)}% advancing` : "n/a"}, market ${marketTrend}).`
        : verdict === "contradict"
          ? `Cross-market context CONTRADICTS the ${input.side} setup on ${input.symbol}: ${contradictCount} factor(s) oppose (${correlated.length} correlated markets, breadth ${breadth ? `${(breadth.advancingRatio * 100).toFixed(0)}% advancing` : "n/a"}, market ${marketTrend}).`
          : `Cross-market context is NEUTRAL for the ${input.side} setup on ${input.symbol}: ${confirmCount} supporting, ${contradictCount} opposing, ${neutralCount} neutral.`;
  }

  return {
    symbol: input.symbol,
    exchangeSymbol: input.exchangeSymbol,
    side: input.side,
    verdict,
    confidence,
    strength,
    score,
    factors,
    relatedMarkets,
    breadth,
    volatility,
    marketTrend,
    dataFresh: true,
    dataAvailable,
    summary,
    computedAt: input.now,
  };
}

/**
 * Compute return series from a candle map. Exported for reuse by
 * the async cache layer and tests.
 */
export function computeReturnSeries(
  candlesBySymbol: Map<string, Array<{ close: number }>>,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [symbol, candles] of candlesBySymbol) {
    const closes = candles.map((c) => c.close).filter((c) => Number.isFinite(c) && c > 0);
    out.set(symbol, returnsFromPrices(closes));
  }
  return out;
}

// Re-export helpers for tests
export { pearsonCorrelation as _pearsonCorrelation };
export type { UniverseMember };
