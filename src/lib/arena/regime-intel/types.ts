// ============================================================
// MARKET REGIME INTELLIGENCE — Types & Interfaces
//
// Extended regime classification with confidence scoring,
// transition detection, and strategy-aware filtering.
//
// Regimes:
//   STRONG_UPTREND, UPTREND, WEAK_UPTREND
//   STRONG_DOWNTREND, DOWNTREND, WEAK_DOWNTREND
//   RANGE, BREAKOUT, BREAKDOWN
//   HIGH_VOLATILITY, LOW_VOLATILITY
//   TRANSITION, DISORDERED
// ============================================================

import type { MarketRegime } from "@/lib/arena/types";

// ── Extended Regime Types ──────────────────────────────────

/** Granular market regime classification. */
export type ExtendedRegime =
  | "strong_uptrend"
  | "uptrend"
  | "weak_uptrend"
  | "strong_downtrend"
  | "downtrend"
  | "weak_downtrend"
  | "range"
  | "breakout"
  | "breakdown"
  | "high_volatility"
  | "low_volatility"
  | "transition"
  | "disordered"
  | "unknown";

/** Mapping from extended to base regime for compatibility. */
export const EXTENDED_TO_BASE_REGIME: Record<ExtendedRegime, MarketRegime> = {
  strong_uptrend: "strong_uptrend",
  uptrend: "uptrend",
  weak_uptrend: "uptrend",
  strong_downtrend: "strong_downtrend",
  downtrend: "downtrend",
  weak_downtrend: "downtrend",
  range: "ranging",
  breakout: "uptrend",
  breakdown: "downtrend",
  high_volatility: "high_volatility",
  low_volatility: "low_volatility",
  transition: "unknown",
  disordered: "unknown",
  unknown: "unknown",
};

// ── Regime Features ────────────────────────────────────────

/** Measurable features extracted from market data for regime classification. */
export interface RegimeFeatures {
  /** Directional strength 0-1 (from ADX-like measure). */
  trendStrength: number;
  /** Trend direction: positive = bullish, negative = bearish. */
  trendDirection: number;
  /** ADX value (0-100). */
  adx: number;
  /** Plus DI - Minus DI spread. */
  diSpread: number;
  /** Volatility level 0-1 (ATR percentile). */
  volatilityLevel: number;
  /** ATR as % of price. */
  atrPercent: number;
  /** Realized volatility (20-period returns std). */
  realizedVol: number;
  /** Bollinger Band width. */
  bbWidth: number;
  /** Momentum rate of change. */
  momentum: number;
  /** Price acceleration (change of momentum). */
  priceAcceleration: number;
  /** RSI (14-period). */
  rsi: number;
  /** OBV slope (normalized). */
  obvSlope: number;
  /** Volume relative to 20-period average. */
  volumeRatio: number;
  /** Volume trend direction. */
  volumeTrend: number;
  /** Price relative to Donchian channel. */
  donchianPosition: number;
  /** Price relative to Bollinger Bands. */
  bbPosition: number;
  /** Number of higher highs and higher lows in last N candles. */
  higherHighs: number;
  higherLows: number;
  lowerHighs: number;
  lowerLows: number;
  /** Number of candles. */
  candleCount: number;
  /** Mean reversion score (0-1): how likely price is reverting to mean. */
  meanReversionScore: number;
  /** Breakout probability: chance of escaping current range. */
  breakoutProbability: number;
}

// ── Regime Confidence ──────────────────────────────────────

/** Confidence metrics for a regime classification. */
export interface RegimeConfidence {
  /** Overall classification confidence 0-1. */
  overall: number;
  /** Confidence in trend component 0-1. */
  trendConfidence: number;
  /** Confidence in volatility component 0-1. */
  volatilityConfidence: number;
  /** Confidence in momentum component 0-1. */
  momentumConfidence: number;
  /** Confidence in volume confirmation 0-1. */
  volumeConfidence: number;
  /** Number of candles analyzed. */
  dataPoints: number;
  /** Whether multi-timeframe confirmation is present. */
  multiTimeframeConfirmed: boolean;
  /** Agreement ratio across timeframes 0-1. */
  timeframeAgreement: number;
}

// ── Regime Transition ──────────────────────────────────────

/** A detected transition between regimes. */
export interface RegimeTransition {
  /** Previous regime. */
  from: ExtendedRegime;
  /** New regime. */
  to: ExtendedRegime;
  /** When the transition was detected. */
  detectedAt: number;
  /** Price at transition. */
  priceAtTransition: number;
  /** Confidence in the transition detection. */
  confidence: number;
  /** Features at transition time. */
  features: RegimeFeatures;
  /** Classification confidence before transition. */
  previousConfidence: RegimeConfidence;
  /** Classification confidence after transition. */
  newConfidence: RegimeConfidence;
}

// ── Regime Intelligence Output ─────────────────────────────

/** Full output from the Regime Intelligence system. */
export interface RegimeIntelligence {
  /** Current regime classification. */
  regime: ExtendedRegime;
  /** Confidence metrics. */
  confidence: RegimeConfidence;
  /** Extracted features. */
  features: RegimeFeatures;
  /** Base regime for compatibility with existing system. */
  baseRegime: MarketRegime;
  /** Whether this regime is suitable for trading. */
  suitableForTrading: boolean;
  /** Suitability score 0-1. */
  suitabilityScore: number;
  /** Recent regime transitions (last N). */
  recentTransitions: RegimeTransition[];
  /** Time since last regime change in ms. */
  timeSinceLastTransition: number;
  /** Stability score: 0 = unstable, 1 = stable. */
  stabilityScore: number;
  /** Strategy adjustment factors. */
  strategyAdjustments: StrategyAdjustments;
  /** When this analysis was generated. */
  analyzedAt: number;
  /** Higher timeframe regime (if available). */
  higherTimeframeRegime: ExtendedRegime | null;
  /** Whether higher timeframe confirms primary regime. */
  higherTimeframeConfirmed: boolean;
}

// ── Strategy Adjustments ───────────────────────────────────

/** Adjustments that strategies should apply based on regime. */
export interface StrategyAdjustments {
  /** Multiplier for position size (0.5 = half size, 1.5 = 50% more). */
  positionSizeMultiplier: number;
  /** Multiplier for take profit distance. */
  takeProfitMultiplier: number;
  /** Multiplier for stop loss distance. */
  stopLossMultiplier: number;
  /** Additional confidence threshold for trade entry. */
  additionalConfidenceRequired: number;
  /** Whether long entries should be avoided. */
  avoidLongs: boolean;
  /** Whether short entries should be avoided. */
  avoidShorts: boolean;
  /** Maximum number of positions during this regime. */
  maxPositions: number;
  /** Whether to tighten risk per trade. */
  tightenRisk: boolean;
  /** Human-readable description of adjustments. */
  reason: string;
}

// ── Regime History ─────────────────────────────────────────

/** Historical regime state for time-series analysis. */
export interface RegimeHistoryEntry {
  regime: ExtendedRegime;
  confidence: number;
  timestamp: number;
}

// ── Regime Intelligence Configuration ──────────────────────

export interface RegimeIntelConfig {
  /** ADX threshold for strong trend. */
  strongTrendAdx: number;
  /** ADX threshold for any trend. */
  trendAdx: number;
  /** Volatility percentile threshold for high vol. */
  highVolatilityPercentile: number;
  /** Volatility percentile threshold for low vol. */
  lowVolatilityPercentile: number;
  /** Number of regime transitions before "disordered". */
  maxTransitionsBeforeDisordered: number;
  /** Time window for counting transitions (ms). */
  transitionWindowMs: number;
  /** Minimum confidence to consider regime settled. */
  minConfidenceForSettled: number;
  /** Number of historical transitions to keep. */
  maxTransitionHistory: number;
  /** Number of historical entries for stability. */
  maxHistoryEntries: number;
}

export const DEFAULT_REGIME_INTEL_CONFIG: RegimeIntelConfig = {
  strongTrendAdx: 40,
  trendAdx: 25,
  highVolatilityPercentile: 0.85,
  lowVolatilityPercentile: 0.15,
  maxTransitionsBeforeDisordered: 4,
  transitionWindowMs: 6 * 60 * 60 * 1000, // 6 hours
  minConfidenceForSettled: 0.6,
  maxTransitionHistory: 50,
  maxHistoryEntries: 200,
};
