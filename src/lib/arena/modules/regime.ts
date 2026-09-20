// ============================================================
// AI TRADE ARENA — Market Regime Analysis Module
//
// Classifies market regime (trending/ranging/volatility) and
// evaluates whether the current regime is suitable for trading.
// Uses multi-timeframe regime detection for robustness.
// ============================================================

import type { AnalysisModule, ModuleInput, ModuleOutput, EvidenceItem } from "./types";
import type { MarketRegime } from "../types";

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function atr(candles: { high: number; low: number; close: number }[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    sum += tr;
  }
  return sum / period;
}

function linearSlope(values: number[]): number | null {
  const n = values.length;
  if (n < 10) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  if (den === 0 || meanY === 0) return null;
  return (num / den) / meanY;
}

interface RegimeResult {
  regime: MarketRegime;
  trendStrength: number;
  volatilityLevel: number;
  suitableForTrading: boolean;
}

function classifyRegime(
  closes: number[],
  candles: { high: number; low: number; close: number }[],
  price: number,
): RegimeResult {
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = closes.length >= 200 ? ema(closes, 200) : null;
  const atrVal = atr(candles, 14);
  const atrPct = atrVal && price > 0 ? atrVal / price : null;
  const slope = linearSlope(closes.slice(-60));

  // Volatility classification
  let volatilityLevel = 0.5; // 0=low, 0.5=normal, 1=high
  if (atrPct != null) {
    if (atrPct > 0.04) volatilityLevel = 1;
    else if (atrPct > 0.02) volatilityLevel = 0.8;
    else if (atrPct < 0.005) volatilityLevel = 0.1;
    else if (atrPct < 0.01) volatilityLevel = 0.3;
  }

  // Trend strength
  let trendStrength = 0;
  if (slope != null) trendStrength = Math.min(1, Math.abs(slope) * 50);

  // Regime classification
  let regime: MarketRegime = "unknown";
  const bullStack = ema20 != null && ema50 != null && ema20 > ema50;
  const bearStack = ema20 != null && ema50 != null && ema20 < ema50;
  const above200 = ema200 != null && price > ema200;

  if (volatilityLevel > 0.9) {
    regime = "high_volatility";
  } else if (volatilityLevel < 0.2 && trendStrength < 0.2) {
    regime = "low_volatility";
  } else if (bullStack && (above200 || ema200 == null) && trendStrength > 0.3) {
    regime = "strong_uptrend";
  } else if (bullStack) {
    regime = "uptrend";
  } else if (bearStack && !above200 && trendStrength > 0.3) {
    regime = "strong_downtrend";
  } else if (bearStack) {
    regime = "downtrend";
  } else {
    regime = "ranging";
  }

  // Suitability: trade in trending regimes with normal-to-high controlled vol
  const suitableForTrading =
    regime !== "ranging" &&
    regime !== "low_volatility" &&
    regime !== "high_volatility" &&
    trendStrength > 0.15;

  return { regime, trendStrength, volatilityLevel, suitableForTrading };
}

export const regimeModule: AnalysisModule = {
  name: "regime",
  description: "Market regime classification: trending/ranging/volatility state",
  weight: 0.15,

  analyze(input: ModuleInput): ModuleOutput {
    const evidence: EvidenceItem[] = [];
    const metrics: Record<string, number> = {};

    const closes = input.candles15m.map(c => c.close);
    if (closes.length < 30 || input.livePrice <= 0) {
      return {
        module: "regime",
        description: this.description,
        direction: "neutral",
        strength: 0,
        confidence: 0.1,
        uncertainty: 1,
        evidence: [{ type: "neutral", label: "Insufficient Data", value: `${closes.length} candles`, detail: "Need at least 30 candles for regime classification." }],
        veto: false,
        metrics: { candleCount: closes.length },
        analyzedAt: input.now,
      };
    }

    // Primary regime (15m)
    const primary = classifyRegime(closes, input.candles15m, input.livePrice);
    metrics.regimeScore = primary.regime === "unknown" ? 0 : primary.regime.includes("uptrend") ? 1 : primary.regime.includes("downtrend") ? -1 : 0;
    metrics.trendStrength = primary.trendStrength;
    metrics.volatilityLevel = primary.volatilityLevel;

    // Higher timeframe context (1h)
    const closes1h = input.candles1h.map(c => c.close);
    let higherTfRegime: MarketRegime = "unknown";
    if (closes1h.length >= 30) {
      const higher = classifyRegime(closes1h, input.candles1h, input.livePrice);
      higherTfRegime = higher.regime;
      metrics.higherTfRegimeScore = higher.regime === "unknown" ? 0 : higher.regime.includes("uptrend") ? 1 : higher.regime.includes("downtrend") ? -1 : 0;
    }

    // Multi-timeframe agreement
    const primaryAligned = input.side === "long"
      ? primary.regime.includes("uptrend")
      : primary.regime.includes("downtrend");
    const higherAligned = input.side === "long"
      ? higherTfRegime.includes("uptrend") || higherTfRegime === "unknown"
      : higherTfRegime.includes("downtrend") || higherTfRegime === "unknown";

    // Evidence
    evidence.push({
      type: primaryAligned ? "supporting" : "contradicting",
      label: "15m Regime",
      value: primary.regime.replace(/_/g, " "),
      detail: `Trend strength: ${(primary.trendStrength * 100).toFixed(0)}%. ${primary.suitableForTrading ? "Suitable for trading." : "Not ideal for new entries."}`,
    });

    if (higherTfRegime !== "unknown") {
      evidence.push({
        type: higherAligned ? "supporting" : "contradicting",
        label: "1h Regime",
        value: higherTfRegime.replace(/_/g, " "),
        detail: higherAligned
          ? "Higher timeframe confirms direction."
          : "Higher timeframe disagrees — reduced confidence.",
      });
    }

    // Volatility context
    if (primary.volatilityLevel > 0.9) {
      evidence.push({
        type: "contradicting",
        label: "Extreme Volatility",
        value: `Level: ${(primary.volatilityLevel * 100).toFixed(0)}%`,
        detail: "Volatility extremely elevated — high risk of stop-hunts and whipsaws.",
      });
    } else if (primary.volatilityLevel < 0.2) {
      evidence.push({
        type: "contradicting",
        label: "Low Volatility",
        value: `Level: ${(primary.volatilityLevel * 100).toFixed(0)}%`,
        detail: "Volatility compressed — breakouts may be false.",
      });
    } else {
      evidence.push({
        type: "supporting",
        label: "Normal Volatility",
        value: `Level: ${(primary.volatilityLevel * 100).toFixed(0)}%`,
        detail: "Volatility within tradeable range.",
      });
    }

    // MTF agreement bonus
    const mtfAgreement = primaryAligned && higherAligned;
    if (mtfAgreement) {
      evidence.push({
        type: "supporting",
        label: "Multi-TF Agreement",
        value: "15m + 1h aligned",
        detail: "Both timeframes agree — strong regime confirmation.",
      });
    } else if (primaryAligned && !higherAligned) {
      evidence.push({
        type: "contradicting",
        label: "Multi-TF Disagreement",
        value: "15m ok, 1h opposes",
        detail: "Primary timeframe aligns but higher timeframe does not.",
      });
    }

    // Veto logic: veto if regime is truly unsuitable
    const veto = !primary.suitableForTrading && !primaryAligned;
    const vetoReason = veto ? `Regime "${primary.regime}" is not suitable for ${input.side} entries` : undefined;

    // Compute direction and confidence
    let bullishScore = 0, bearishScore = 0;
    if (primary.regime.includes("uptrend")) bullishScore += primary.trendStrength;
    if (primary.regime.includes("downtrend")) bearishScore += primary.trendStrength;
    if (higherTfRegime.includes("uptrend")) bullishScore += primary.trendStrength * 0.5;
    if (higherTfRegime.includes("downtrend")) bearishScore += primary.trendStrength * 0.5;

    const rawScore = bullishScore + bearishScore > 0
      ? (bullishScore - bearishScore) / (bullishScore + bearishScore)
      : 0;

    return {
      module: "regime",
      description: this.description,
      direction: rawScore > 0.15 ? "bullish" : rawScore < -0.15 ? "bearish" : "neutral",
      strength: Math.min(1, Math.abs(rawScore) * (1 + (mtfAgreement ? 0.3 : 0))),
      confidence: primary.regime === "unknown" ? 0.2 : mtfAgreement ? 0.85 : 0.6,
      uncertainty: primary.regime === "unknown" ? 0.8 : mtfAgreement ? 0.15 : 0.4,
      evidence,
      veto,
      vetoReason,
      metrics,
      analyzedAt: input.now,
    };
  },
};
