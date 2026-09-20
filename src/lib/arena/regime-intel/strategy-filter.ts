// ============================================================
// MARKET REGIME INTELLIGENCE — Strategy Filter
//
// Adjusts strategy parameters based on detected regime.
// Makes strategies aware of regime so they can filter
// or reduce confidence in unsuitable conditions.
//
// NEVER forces a trade — only reduces/enhances confidence
// and adjusts position sizing.
// ============================================================

import type { TradeSide } from "@/lib/arena/types";
import type {
  ExtendedRegime,
  RegimeIntelligence,
  StrategyAdjustments,
} from "./types";

// ── Regime-Strategy Suitability Matrix ─────────────────────

/**
 * How suitable each regime is for long/short trades.
 * 0 = completely unsuitable, 1 = ideal.
 */
const REGIME_LONG_SUITABILITY: Record<ExtendedRegime, number> = {
  strong_uptrend: 1.0,
  uptrend: 0.8,
  weak_uptrend: 0.5,
  strong_downtrend: 0.1,
  downtrend: 0.2,
  weak_downtrend: 0.35,
  range: 0.3,
  breakout: 0.9,
  breakdown: 0.1,
  high_volatility: 0.15,
  low_volatility: 0.2,
  transition: 0.2,
  disordered: 0.05,
  unknown: 0.3,
};

const REGIME_SHORT_SUITABILITY: Record<ExtendedRegime, number> = {
  strong_uptrend: 0.1,
  uptrend: 0.2,
  weak_uptrend: 0.35,
  strong_downtrend: 1.0,
  downtrend: 0.8,
  weak_downtrend: 0.5,
  range: 0.3,
  breakout: 0.1,
  breakdown: 0.9,
  high_volatility: 0.15,
  low_volatility: 0.2,
  transition: 0.2,
  disordered: 0.05,
  unknown: 0.3,
};

/**
 * Compute strategy adjustments based on regime intelligence.
 */
export function computeStrategyAdjustments(
  regimeIntel: RegimeIntelligence,
  side: TradeSide,
): StrategyAdjustments {
  const regime = regimeIntel.regime;
  const confidence = regimeIntel.confidence.overall;
  const stability = regimeIntel.stabilityScore;

  const suitability = side === "long"
    ? REGIME_LONG_SUITABILITY[regime]
    : REGIME_SHORT_SUITABILITY[regime];

  // ── Position Size Multiplier ───────────────────────────

  // Reduce size in uncertain/unstable regimes
  let positionSizeMultiplier = 1.0;

  if (suitability < 0.3) {
    positionSizeMultiplier = 0.3; // Very small in bad regime
  } else if (suitability < 0.5) {
    positionSizeMultiplier = 0.5;
  } else if (suitability > 0.8 && stability > 0.7) {
    positionSizeMultiplier = 1.2; // Slight increase in ideal conditions
  }

  // Reduce in low confidence
  if (confidence < 0.5) {
    positionSizeMultiplier *= 0.6;
  } else if (confidence < 0.7) {
    positionSizeMultiplier *= 0.8;
  }

  // Reduce in disordered
  if (regime === "disordered") {
    positionSizeMultiplier = 0.1;
  }

  // ── Take Profit Multiplier ────────────────────────────

  // In strong trends, let profits run wider
  // In weak trends/ranges, take profits sooner
  let takeProfitMultiplier = 1.0;

  if (regime.includes("strong")) {
    takeProfitMultiplier = 1.3; // extend TP in strong trend
  } else if (regime === "weak_uptrend" || regime === "weak_downtrend") {
    takeProfitMultiplier = 0.8; // take profits sooner
  } else if (regime === "range") {
    takeProfitMultiplier = 0.7; // range: quick TP
  } else if (regime === "breakout" || regime === "breakdown") {
    takeProfitMultiplier = 1.1; // breakout: let it run a bit
  }

  // ── Stop Loss Multiplier ──────────────────────────────

  // Tighter stops in ranging, wider in trending
  let stopLossMultiplier = 1.0;

  if (regime.includes("strong")) {
    stopLossMultiplier = 1.2; // wider stops in strong trends (allow more room)
  } else if (regime === "range" || regime === "weak_uptrend" || regime === "weak_downtrend") {
    stopLossMultiplier = 0.8; // tighter stops in weak/ranging
  } else if (regime === "high_volatility") {
    stopLossMultiplier = 1.5; // much wider stops in high vol
  }

  // ── Additional Confidence Required ────────────────────

  // In unfavorable regimes, require MORE evidence before trading
  let additionalConfidenceRequired = 0;

  if (suitability < 0.3) {
    additionalConfidenceRequired = 0.2; // need 20% more confidence
  } else if (suitability < 0.5) {
    additionalConfidenceRequired = 0.1;
  } else if (regime === "transition") {
    additionalConfidenceRequired = 0.15;
  }

  // ── Direction Avoidance ───────────────────────────────

  const avoidLongs = side === "long" && suitability < 0.15;
  const avoidShorts = side === "short" && suitability < 0.15;

  // ── Max Positions ─────────────────────────────────────

  let maxPositions = 1;
  if (regime.includes("strong") && stability > 0.6) {
    maxPositions = 2; // allow more in strong stable trends
  } else if (regime === "disordered" || regime === "high_volatility") {
    maxPositions = 0; // no new positions
  }

  // ── Tighten Risk ──────────────────────────────────────

  const tightenRisk =
    regime === "high_volatility" ||
    regime === "disordered" ||
    regime === "transition" ||
    stability < 0.3;

  // ── Reason ────────────────────────────────────────────

  const reason = buildAdjustmentReason(
    regime, side, suitability, confidence, stability, maxPositions,
  );

  return {
    positionSizeMultiplier: Math.max(0.1, Math.min(1.5, positionSizeMultiplier)),
    takeProfitMultiplier: Math.max(0.5, Math.min(2.0, takeProfitMultiplier)),
    stopLossMultiplier: Math.max(0.5, Math.min(2.0, stopLossMultiplier)),
    additionalConfidenceRequired: Math.max(0, Math.min(0.3, additionalConfidenceRequired)),
    avoidLongs,
    avoidShorts,
    maxPositions,
    tightenRisk,
    reason,
  };
}

function buildAdjustmentReason(
  regime: ExtendedRegime,
  side: TradeSide,
  suitability: number,
  confidence: number,
  stability: number,
  maxPositions: number,
): string {
  const parts: string[] = [];

  parts.push(`Regime: ${regime.replace(/_/g, " ")}`);

  if (suitability > 0.8) {
    parts.push(`${side} suitability: HIGH (${(suitability * 100).toFixed(0)}%)`);
  } else if (suitability > 0.5) {
    parts.push(`${side} suitability: MODERATE (${(suitability * 100).toFixed(0)}%)`);
  } else if (suitability > 0.2) {
    parts.push(`${side} suitability: LOW (${(suitability * 100).toFixed(0)}%)`);
  } else {
    parts.push(`${side} suitability: VERY LOW (${(suitability * 100).toFixed(0)}%)`);
  }

  if (confidence < 0.5) {
    parts.push("Low classification confidence — reduced position size");
  }

  if (stability < 0.3) {
    parts.push("Unstable regime — tightened risk management");
  }

  if (maxPositions === 0) {
    parts.push("No new positions allowed in current regime");
  }

  return parts.join(". ");
}

/**
 * Get the minimum regime suitability required to trade a given side.
 */
export function getRegimeSuitabilityScore(
  regime: ExtendedRegime,
  side: TradeSide,
): number {
  return side === "long"
    ? REGIME_LONG_SUITABILITY[regime]
    : REGIME_SHORT_SUITABILITY[regime];
}
