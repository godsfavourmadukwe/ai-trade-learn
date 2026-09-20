// ============================================================
// MARKET REGIME INTELLIGENCE — Regime Classifier
//
// Classifies market regime from extracted features with
// confidence scoring and multi-timeframe confirmation.
// ============================================================

import type { Candle } from "@/lib/market/types";
import type {
  ExtendedRegime,
  RegimeConfidence,
  RegimeFeatures,
  RegimeIntelConfig,
  DEFAULT_REGIME_INTEL_CONFIG,
} from "./types";
import { extractRegimeFeatures } from "./features";

// ── Classifier ─────────────────────────────────────────────

export interface RegimeClassification {
  regime: ExtendedRegime;
  confidence: RegimeConfidence;
  features: RegimeFeatures;
}

/**
 * Classify market regime from extracted features.
 * Uses ADX for trend strength, DI for direction,
 * volatility percentile, and volume/momentum for confirmation.
 */
export function classifyRegime(
  features: RegimeFeatures,
  config: RegimeIntelConfig,
): RegimeClassification {
  const {
    adx,
    trendDirection,
    trendStrength,
    volatilityLevel,
    atrPercent,
    rsi,
    momentum,
    volumeRatio,
    bbPosition,
    higherHighs,
    higherLows,
    lowerHighs,
    lowerLows,
    meanReversionScore,
    breakoutProbability,
    donchianPosition,
    bbWidth,
  } = features;

  // ── Trend Classification ──────────────────────────────

  let regime: ExtendedRegime = "unknown";
  let trendConfidence = 0;
  let volatilityConfidence = 0;
  let momentumConfidence = 0;
  let volumeConfidence = 0;

  // Strong trend: ADX > 40 and clear direction
  if (adx > config.strongTrendAdx && trendDirection !== 0) {
    regime = trendDirection > 0 ? "strong_uptrend" : "strong_downtrend";
    trendConfidence = Math.min(1, adx / 60);
  }
  // Moderate trend: ADX > 25
  else if (adx > config.trendAdx && trendDirection !== 0) {
    regime = trendDirection > 0 ? "uptrend" : "downtrend";
    trendConfidence = Math.min(1, adx / 40);
  }
  // Weak trend: ADX between 15-25 with some directional bias
  else if (adx > 15 && trendDirection !== 0) {
    regime = trendDirection > 0 ? "weak_uptrend" : "weak_downtrend";
    trendConfidence = Math.min(1, adx / 25);
  }

  // ── Volatility Override ───────────────────────────────

  // Check volatility extremes first — they override trend
  if (volatilityLevel > config.highVolatilityPercentile) {
    regime = "high_volatility";
    volatilityConfidence = Math.min(1, volatilityLevel);
  } else if (volatilityLevel < config.lowVolatilityPercentile && adx < 20) {
    regime = "low_volatility";
    volatilityConfidence = Math.min(1, 1 - volatilityLevel);
  }

  // ── Breakout/Breakdown Detection ──────────────────────

  // High breakout probability + price near boundary + volume spike
  if (
    breakoutProbability > 0.6 &&
    (donchianPosition > 0.9 || donchianPosition < 0.1) &&
    volumeRatio > 1.2
  ) {
    if (donchianPosition > 0.9) {
      regime = "breakout";
    } else {
      regime = "breakdown";
    }
  }

  // ── Range Detection ───────────────────────────────────

  // ADX < 20, mean reversion score high, no breakout signal
  if (
    adx < 20 &&
    meanReversionScore > 0.5 &&
    breakoutProbability < 0.4 &&
    regime !== "high_volatility" &&
    regime !== "low_volatility"
  ) {
    regime = "range";
    trendConfidence = 0.7; // confident it's ranging
  }

  // ── Weak Trend Refinement ─────────────────────────────

  // If we classified as weak trend but mean reversion is high, shift to range
  if (
    (regime === "weak_uptrend" || regime === "weak_downtrend") &&
    meanReversionScore > 0.6
  ) {
    regime = "range";
    trendConfidence = Math.max(0.4, trendConfidence - 0.2);
  }

  // ── Volatility Confidence ─────────────────────────────

  if (regime === "high_volatility" || regime === "low_volatility") {
    volatilityConfidence = Math.min(1, Math.abs(volatilityLevel - 0.5) * 2);
  } else {
    // Normal volatility: confidence that it's NOT extreme
    const distFromExtreme = Math.min(
      volatilityLevel - config.lowVolatilityPercentile,
      config.highVolatilityPercentile - volatilityLevel,
    );
    volatilityConfidence = Math.max(0, Math.min(1, distFromExtreme * 5));
  }

  // ── Momentum Confidence ───────────────────────────────

  const momentumAligned =
    (regime.includes("uptrend") || regime === "breakout") && momentum > 0 ||
    (regime.includes("downtrend") || regime === "breakdown") && momentum < 0;

  if (momentumAligned) {
    momentumConfidence = Math.min(1, Math.abs(momentum) * 10);
  } else if (regime === "range" || regime === "high_volatility" || regime === "low_volatility") {
    // Momentum neutral is fine for these regimes
    momentumConfidence = 0.5;
  } else {
    momentumConfidence = Math.max(0, 0.3 - Math.abs(momentum));
  }

  // ── Volume Confidence ─────────────────────────────────

  // Volume confirms trend: increasing volume in trend direction
  if (regime.includes("uptrend") || regime === "breakout") {
    volumeConfidence = volumeRatio > 1 ? Math.min(1, volumeRatio / 2) : 0.3;
  } else if (regime.includes("downtrend") || regime === "breakdown") {
    volumeConfidence = volumeRatio > 1 ? Math.min(1, volumeRatio / 2) : 0.3;
  } else {
    // Range: volume doesn't need to confirm
    volumeConfidence = 0.5;
  }

  // ── Overall Confidence ────────────────────────────────

  const overall =
    trendConfidence * 0.35 +
    volatilityConfidence * 0.2 +
    momentumConfidence * 0.25 +
    volumeConfidence * 0.2;

  return {
    regime,
    confidence: {
      overall: Math.max(0, Math.min(1, overall)),
      trendConfidence: Math.max(0, Math.min(1, trendConfidence)),
      volatilityConfidence: Math.max(0, Math.min(1, volatilityConfidence)),
      momentumConfidence: Math.max(0, Math.min(1, momentumConfidence)),
      volumeConfidence: Math.max(0, Math.min(1, volumeConfidence)),
      dataPoints: features.candleCount,
      multiTimeframeConfirmed: false,
      timeframeAgreement: 0,
    },
    features,
  };
}

/**
 * Classify with multi-timeframe confirmation.
 * Compares primary (15m) regime with higher timeframe (1h).
 */
export function classifyRegimeMTF(
  candles15m: Candle[],
  candles1h: Candle[],
  livePrice: number,
  priceHistory: number[],
  config: RegimeIntelConfig,
): RegimeClassification | null {
  const primaryFeatures = extractRegimeFeatures(candles15m, candles1h, livePrice, priceHistory);
  if (!primaryFeatures) return null;

  const primary = classifyRegime(primaryFeatures, config);

  // Classify higher timeframe
  const higherFeatures = extractRegimeFeatures(candles1h, [], livePrice, priceHistory);
  if (higherFeatures) {
    const higher = classifyRegime(higherFeatures, config);

    // Check agreement
    const primaryDirection = getRegimeDirection(primary.regime);
    const higherDirection = getRegimeDirection(higher.regime);

    const agreement = primaryDirection === higherDirection || higherDirection === 0;
    const agreementRatio = agreement ? 1 :
      primaryDirection !== 0 && higherDirection !== 0 ? 0 : 0.5;

    primary.confidence.multiTimeframeConfirmed = agreement;
    primary.confidence.timeframeAgreement = agreementRatio;

    // Boost confidence if MTF agrees
    if (agreement) {
      primary.confidence.overall = Math.min(1, primary.confidence.overall * 1.2);
      primary.confidence.trendConfidence = Math.min(1, primary.confidence.trendConfidence * 1.15);
    }
  }

  return primary;
}

/** Get directional lean of a regime: 1=bullish, -1=bearish, 0=neutral. */
function getRegimeDirection(regime: ExtendedRegime): number {
  if (regime.includes("uptrend") || regime === "breakout") return 1;
  if (regime.includes("downtrend") || regime === "breakdown") return -1;
  return 0;
}
