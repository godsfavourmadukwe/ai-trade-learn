// ============================================================
// AI TRADE ARENA — Momentum / Trend Analysis Module
//
// Analyzes momentum via rate-of-change, ADX, stochastic,
// price acceleration, and trend persistence.
// Focuses on measuring the strength and direction of movement.
// ============================================================

import type { AnalysisModule, ModuleInput, ModuleOutput, EvidenceItem } from "./types";

function momentum(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  return (closes[closes.length - 1] - closes[closes.length - 1 - period]) / closes[closes.length - 1 - period];
}

function roc(closes: number[], period: number): number | null {
  return momentum(closes, period);
}

function stochastic(candles: { high: number; low: number; close: number }[], kPeriod = 14, dPeriod = 3): { k: number; d: number } | null {
  if (candles.length < kPeriod + dPeriod) return null;
  const kValues: number[] = [];
  for (let i = candles.length - kPeriod - dPeriod + 1; i < candles.length; i++) {
    const window = candles.slice(i, i + kPeriod);
    const high = Math.max(...window.map(c => c.high));
    const low = Math.min(...window.map(c => c.low));
    const k = high === low ? 50 : ((candles[i + kPeriod - 1].close - low) / (high - low)) * 100;
    kValues.push(k);
  }
  const k = kValues[kValues.length - 1];
  const d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
  return { k, d };
}

function adx(candles: { high: number; low: number; close: number }[], period = 14): number | null {
  if (candles.length < period * 2) return null;

  const trueRanges: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    trueRanges.push(tr);

    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  if (trueRanges.length < period) return null;

  // Smoothed averages
  let atrSmooth = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let plusDMSmooth = plusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let minusDMSmooth = minusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const dxValues: number[] = [];
  for (let i = period; i < trueRanges.length; i++) {
    atrSmooth = (atrSmooth * (period - 1) + trueRanges[i]) / period;
    plusDMSmooth = (plusDMSmooth * (period - 1) + plusDMs[i]) / period;
    minusDMSmooth = (minusDMSmooth * (period - 1) + minusDMs[i]) / period;

    const plusDI = atrSmooth > 0 ? (plusDMSmooth / atrSmooth) * 100 : 0;
    const minusDI = atrSmooth > 0 ? (minusDMSmooth / atrSmooth) * 100 : 0;
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    dxValues.push(dx);
  }

  if (dxValues.length < period) return null;
  let adxVal = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adxVal = (adxVal * (period - 1) + dxValues[i]) / period;
  }
  return adxVal;
}

function priceAcceleration(closes: number[], period = 5): number | null {
  if (closes.length < period * 2) return null;
  const recentMom = (closes[closes.length - 1] - closes[closes.length - 1 - period]) / closes[closes.length - 1 - period];
  const prevMom = (closes[closes.length - 1 - period] - closes[closes.length - 1 - period * 2]) / closes[closes.length - 1 - period * 2];
  return recentMom - prevMom;
}

export const momentumModule: AnalysisModule = {
  name: "momentum",
  description: "Momentum analysis: ROC, ADX, stochastic, acceleration, trend persistence",
  weight: 0.20,

  analyze(input: ModuleInput): ModuleOutput {
    const evidence: EvidenceItem[] = [];
    const metrics: Record<string, number> = {};
    let bullishPoints = 0;
    let bearishPoints = 0;
    let totalPoints = 0;

    const closes = input.candles15m.map(c => c.close);
    if (closes.length < 30) {
      return {
        module: "momentum",
        description: this.description,
        direction: "neutral",
        strength: 0,
        confidence: 0.1,
        uncertainty: 1,
        evidence: [{ type: "neutral", label: "Insufficient Data", value: `${closes.length} candles`, detail: "Need at least 30 candles for momentum analysis." }],
        veto: false,
        metrics: { candleCount: closes.length },
        analyzedAt: input.now,
      };
    }

    // ── Rate of Change (multiple periods) ──
    const roc5 = roc(closes, 5);
    const roc10 = roc(closes, 10);
    const roc20 = roc(closes, 20);
    if (roc5 != null) metrics.roc5 = roc5;
    if (roc10 != null) metrics.roc10 = roc10;
    if (roc20 != null) metrics.roc20 = roc20;

    if (roc5 != null && roc10 != null) {
      const shortTermAccelerating = Math.abs(roc5) > Math.abs(roc10);
      const rocAligned = input.side === "long" ? roc5 > 0 && roc10 > 0 : roc5 < 0 && roc10 < 0;

      if (rocAligned && shortTermAccelerating) {
        bullishPoints += input.side === "long" ? 3 : 0;
        bearishPoints += input.side === "short" ? 3 : 0;
        evidence.push({
          type: "supporting",
          label: "Accelerating Momentum",
          value: `ROC5=${(roc5 * 100).toFixed(2)}%, ROC10=${(roc10 * 100).toFixed(2)}%`,
          detail: "Short-term momentum accelerating in trade direction.",
        });
      } else if (rocAligned) {
        bullishPoints += input.side === "long" ? 2 : 0;
        bearishPoints += input.side === "short" ? 2 : 0;
        evidence.push({
          type: "supporting",
          label: "Directional Momentum",
          value: `ROC5=${(roc5 * 100).toFixed(2)}%`,
          detail: "Momentum positive in trade direction.",
        });
      } else {
        evidence.push({
          type: "contradicting",
          label: "Momentum Against",
          value: `ROC5=${(roc5 * 100).toFixed(2)}%`,
          detail: "Rate of change opposes trade direction.",
        });
      }
      totalPoints += 3;
    }

    // ── ADX (trend strength) ──
    const adxVal = adx(input.candles15m);
    if (adxVal != null) {
      metrics.adx = adxVal;
      const strongTrend = adxVal > 25;
      const veryStrongTrend = adxVal > 40;

      if (strongTrend) {
        bullishPoints += input.side === "long" ? 2 : 0;
        bearishPoints += input.side === "short" ? 2 : 0;
        evidence.push({
          type: "supporting",
          label: "Strong Trend (ADX)",
          value: `ADX=${adxVal.toFixed(1)}`,
          detail: `${veryStrongTrend ? "Very strong" : "Strong"} directional movement — trend is well-established.`,
        });
      } else {
        evidence.push({
          type: "contradicting",
          label: "Weak Trend (ADX)",
          value: `ADX=${adxVal.toFixed(1)}`,
          detail: "Weak directional movement — trend may be forming or fading.",
        });
      }
      totalPoints += 2;
    }

    // ── Stochastic ──
    const stoch = stochastic(input.candles15m);
    if (stoch) {
      metrics.stochK = stoch.k;
      metrics.stochD = stoch.d;
      const stochAligned = input.side === "long" ? stoch.k > 50 && stoch.k < 85 : stoch.k < 50 && stoch.k > 15;
      const stochCross = input.side === "long" ? stoch.k > stoch.d : stoch.k < stoch.d;

      if (stochAligned && stochCross) {
        bullishPoints += input.side === "long" ? 1.5 : 0;
        bearishPoints += input.side === "short" ? 1.5 : 0;
        evidence.push({
          type: "supporting",
          label: "Stochastic Confirmation",
          value: `K=${stoch.k.toFixed(1)}, D=${stoch.d.toFixed(1)}`,
          detail: "Stochastic in favorable zone with bullish/bearish crossover.",
        });
      } else if (stoch.k > 85 || stoch.k < 15) {
        evidence.push({
          type: "contradicting",
          label: "Stochastic Extreme",
          value: `K=${stoch.k.toFixed(1)}`,
          detail: stoch.k > 85 ? "Overbought — risk of reversal." : "Oversold — risk of bounce.",
        });
      } else {
        evidence.push({
          type: "neutral",
          label: "Stochastic Neutral",
          value: `K=${stoch.k.toFixed(1)}`,
          detail: "Stochastic in neutral zone.",
        });
      }
      totalPoints += 1.5;
    }

    // ── Price Acceleration ──
    const accel = priceAcceleration(closes);
    if (accel != null) {
      metrics.acceleration = accel;
      const accelAligned = input.side === "long" ? accel > 0 : accel < 0;
      if (accelAligned) {
        bullishPoints += input.side === "long" ? 1 : 0;
        bearishPoints += input.side === "short" ? 1 : 0;
        evidence.push({
          type: "supporting",
          label: "Price Acceleration",
          value: `${(accel * 100).toFixed(3)}%`,
          detail: "Price movement is accelerating in the trade direction.",
        });
      } else {
        evidence.push({
          type: "contradicting",
          label: "Deceleration",
          value: `${(accel * 100).toFixed(3)}%`,
          detail: "Price movement decelerating against trade direction.",
        });
      }
      totalPoints += 1;
    }

    // ── Aggregate ──
    const rawScore = totalPoints > 0 ? (bullishPoints - bearishPoints) / totalPoints : 0;
    const direction = rawScore > 0.1 ? "bullish" : rawScore < -0.1 ? "bearish" : "neutral";
    const agreementRatio = totalPoints > 0 ? Math.max(bullishPoints, bearishPoints) / totalPoints : 0.5;
    const confidence = Math.min(0.95, Math.max(0.1, agreementRatio * (closes.length >= 100 ? 1 : closes.length / 100)));
    const uncertainty = Math.max(0.05, 1 - confidence);

    return {
      module: "momentum",
      description: this.description,
      direction,
      strength: Math.min(1, Math.abs(rawScore)),
      confidence,
      uncertainty,
      evidence,
      veto: false,
      metrics,
      analyzedAt: input.now,
    };
  },
};
