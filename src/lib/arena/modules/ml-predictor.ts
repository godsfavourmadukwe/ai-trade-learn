// ============================================================
// AI TRADE ARENA — ML / Quantitative Predictor Module
//
// Quantitative ensemble model — NOT an LLM.
// Estimates probability of TP before SL, expected return,
// and model uncertainty using multiple lightweight models.
//
// Models:
//   1. Trend-following logistic model
//   2. Mean-reversion logistic model
//   3. Momentum scoring model
//   4. Volatility-adjusted expectancy
//   5. Multi-factor regression approximation
//
// All computation is from historical data only — no leakage.
// ============================================================

import type { AnalysisModule, ModuleInput, ModuleOutput, EvidenceItem } from "./types";
import type { TradeSide } from "../types";

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

/** Logistic function: maps z-score to 0-1 probability. */
function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

// ── Individual sub-models ─────────────────────────────────

/** Model 1: Trend-following logistic — based on EMA alignment and price-EMA distance. */
function trendModel(closes: number[], side: TradeSide): number {
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  if (ema20 == null || ema50 == null || closes.length < 50) return 0.5;

  const price = closes[closes.length - 1];
  const aligned = side === "long" ? ema20 > ema50 : ema20 < ema50;
  const distFromEma = ema50 > 0 ? (price - ema50) / ema50 : 0;
  const emaGap = ema50 > 0 ? (ema20 - ema50) / ema50 : 0;

  // z-score: how many standard deviations away from neutral
  let z = 0;
  if (aligned) z += 1.0;
  if (side === "long" && distFromEma > 0) z += distFromEma * 50;
  if (side === "short" && distFromEma < 0) z += Math.abs(distFromEma) * 50;
  z += Math.abs(emaGap) * 100;

  return sigmoid(z * (side === "long" ? 1 : -1));
}

/** Model 2: Momentum scoring — based on short/medium ROC and stochastic. */
function momentumModel(closes: number[], side: TradeSide): number {
  if (closes.length < 20) return 0.5;

  const roc5 = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6];
  const roc10 = (closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11];
  const roc20 = (closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21];

  let z = 0;
  // Short-term momentum
  z += roc5 * 100;
  z += roc10 * 50;
  z += roc20 * 25;

  return sigmoid(z * (side === "long" ? 1 : -1));
}

/** Model 3: Volatility-adjusted expectancy — how likely is a favorable move given current vol. */
function volatilityAdjustedModel(closes: number[], side: TradeSide): number {
  if (closes.length < 30) return 0.5;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const recentReturns = returns.slice(-20);
  const vol = stddev(recentReturns);
  if (vol === 0) return 0.5;

  const meanReturn = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
  const directionMean = side === "long" ? meanReturn : -meanReturn;

  // Sharpe-like ratio of recent returns
  const z = vol > 0 ? directionMean / vol : 0;
  return sigmoid(z * 2);
}

/** Model 4: Historical win-rate estimation — pattern matching on similar conditions. */
function historicalModel(closes: number[], side: TradeSide): number {
  if (closes.length < 50) return 0.5;

  // Look at the last 50 bars and count how many similar setups resulted in continuation
  const currentReturn = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6];
  const currentVol = stddev(closes.slice(-20).map((c, i, arr) => i > 0 && arr[i - 1] > 0 ? (c - arr[i - 1]) / arr[i - 1] : 0));

  let wins = 0, total = 0;
  for (let i = 50; i < closes.length - 5; i++) {
    const pastReturn = (closes[i] - closes[i - 5]) / closes[i - 5];
    const pastVol = stddev(closes.slice(i - 20, i).map((c, j, arr) => j > 0 && arr[j - 1] > 0 ? (c - arr[j - 1]) / arr[j - 1] : 0));

    // Similar setup if return and vol are within 50%
    if (Math.abs(pastReturn - currentReturn) < Math.abs(currentReturn) * 0.5 + 0.001 &&
        Math.abs(pastVol - currentVol) < currentVol * 0.5 + 0.001) {
      total++;
      const futureReturn = (closes[i + 5] - closes[i]) / closes[i];
      if ((side === "long" && futureReturn > 0) || (side === "short" && futureReturn < 0)) {
        wins++;
      }
    }
  }

  return total >= 5 ? wins / total : 0.5;
}

// ── Ensemble ──────────────────────────────────────────────

interface ModelResult {
  probability: number;
  model: string;
  weight: number;
}

function ensemblePredict(closes: number[], side: TradeSide): {
  probability: number;
  uncertainty: number;
  modelResults: ModelResult[];
} {
  const models: ModelResult[] = [
    { probability: trendModel(closes, side), model: "trend_logistic", weight: 0.30 },
    { probability: momentumModel(closes, side), model: "momentum_score", weight: 0.25 },
    { probability: volatilityAdjustedModel(closes, side), model: "vol_adjusted", weight: 0.25 },
    { probability: historicalModel(closes, side), model: "historical_match", weight: 0.20 },
  ];

  // Weighted average
  const totalWeight = models.reduce((s, m) => s + m.weight, 0);
  const weightedProb = models.reduce((s, m) => s + m.probability * m.weight, 0) / totalWeight;

  // Uncertainty: disagreement between models
  const probs = models.map(m => m.probability);
  const modelStd = stddev(probs);
  const uncertainty = Math.min(0.5, modelStd * 2); // higher disagreement = higher uncertainty

  // Clip to reasonable range
  const probability = Math.max(0.15, Math.min(0.85, weightedProb));

  return { probability, uncertainty, modelResults: models };
}

export const mlPredictorModule: AnalysisModule = {
  name: "ml_predictor",
  description: "Quantitative ML ensemble: probability estimation, expected return, uncertainty",
  weight: 0.20,

  analyze(input: ModuleInput): ModuleOutput {
    const evidence: EvidenceItem[] = [];
    const metrics: Record<string, number> = {};

    const closes = input.candles15m.map(c => c.close);
    if (closes.length < 50) {
      return {
        module: "ml_predictor",
        description: this.description,
        direction: "neutral",
        strength: 0,
        confidence: 0.1,
        uncertainty: 1,
        evidence: [{ type: "neutral", label: "Insufficient Data", value: `${closes.length} candles`, detail: "Need at least 50 candles for ML prediction." }],
        veto: false,
        metrics: { candleCount: closes.length },
        analyzedAt: input.now,
      };
    }

    // Run ensemble
    const { probability, uncertainty, modelResults } = ensemblePredict(closes, input.side);

    metrics.modelProbability = probability;
    metrics.modelUncertainty = uncertainty;

    // Expected return estimation
    const price = input.livePrice;
    const atr14 = computeATR(input.candles15m, 14);
    const stopDistance = atr14 ? atr14 * 2 : price * 0.02;
    const targetDistance = atr14 ? atr14 * 4 : price * 0.04;
    const riskReward = stopDistance > 0 ? targetDistance / stopDistance : 0;

    const expectedReturn = probability * (targetDistance / price) - (1 - probability) * (stopDistance / price);
    const feesCost = 0.002; // 0.1% round trip
    const expectedValue = expectedReturn - feesCost;

    metrics.expectedReturn = expectedReturn;
    metrics.expectedValue = expectedValue;
    metrics.riskReward = riskReward;
    metrics.stopDistance = stopDistance;
    metrics.targetDistance = targetDistance;

    // Evidence
    evidence.push({
      type: probability > 0.55 ? "supporting" : probability < 0.45 ? "contradicting" : "neutral",
      label: "Model Probability",
      value: `${(probability * 100).toFixed(1)}%`,
      detail: `Ensemble estimates ${(probability * 100).toFixed(1)}% chance TP is hit before SL. Threshold: 55%.`,
    });

    evidence.push({
      type: expectedValue > 0 ? "supporting" : "contradicting",
      label: "Expected Value",
      value: `${(expectedValue * 100).toFixed(3)}%`,
      detail: `After ${(feesCost * 100).toFixed(1)}% fees. ${expectedValue > 0 ? "Positive EV." : "Negative EV — no edge."}`,
    });

    evidence.push({
      type: "neutral",
      label: "Model Uncertainty",
      value: `${(uncertainty * 100).toFixed(1)}%`,
      detail: uncertainty < 0.15 ? "Models agree — low uncertainty."
        : uncertainty < 0.3 ? "Moderate model disagreement."
        : "High model disagreement — unreliable prediction.",
    });

    // Sub-model details
    for (const mr of modelResults) {
      metrics[`submodel_${mr.model}`] = mr.probability;
      evidence.push({
        type: "neutral",
        label: `Sub-model: ${mr.model}`,
        value: `${(mr.probability * 100).toFixed(1)}%`,
        detail: `Weight: ${(mr.weight * 100).toFixed(0)}%`,
        weight: mr.weight,
      });
    }

    // Risk/reward evidence
    evidence.push({
      type: riskReward >= 1.5 ? "supporting" : "contradicting",
      label: "Risk/Reward",
      value: `1:${riskReward.toFixed(2)}`,
      detail: `Stop: ${stopDistance.toFixed(2)}, Target: ${targetDistance.toFixed(2)}`,
    });

    // ── Veto logic ──
    const veto = uncertainty > 0.35 || (probability < 0.4 && expectedValue < 0);
    const vetoReason = veto
      ? uncertainty > 0.35
        ? "Model uncertainty too high — predictions unreliable"
        : "Model probability and expected value both negative"
      : undefined;

    // Direction
    const direction = probability > 0.55 ? (input.side === "long" ? "bullish" : "bearish") : probability < 0.45 ? (input.side === "long" ? "bearish" : "bullish") : "neutral";
    const strength = Math.abs(probability - 0.5) * 2;
    const confidence = Math.max(0.1, 1 - uncertainty * 2);

    return {
      module: "ml_predictor",
      description: this.description,
      direction,
      strength: Math.min(1, strength),
      confidence: Math.min(0.95, confidence),
      uncertainty,
      evidence,
      veto,
      vetoReason,
      metrics,
      analyzedAt: input.now,
    };
  },
};

function computeATR(candles: { high: number; low: number; close: number }[], period: number): number | null {
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
