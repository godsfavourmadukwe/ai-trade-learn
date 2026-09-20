// ============================================================
// AI TRADE ARENA — Technical / Quantitative Analysis Module
//
// Analyzes price structure via EMA alignment, RSI, MACD,
// Bollinger Bands, and support/resistance levels.
// Produces directional evidence from classical TA indicators.
// ============================================================

import type { AnalysisModule, ModuleInput, ModuleOutput, EvidenceItem } from "./types";

// ── Indicator helpers (no external deps) ──────────────────

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function macd(closes: number[]): { macd: number; signal: number; hist: number } | null {
  if (closes.length < 35) return null;
  const ema12 = ema(closes, 12)!;
  const ema26 = ema(closes, 26)!;
  const macdLine = ema12 - ema26;
  // Approximate signal line from recent MACD values
  const macdValues: number[] = [];
  for (let i = 26; i <= closes.length; i++) {
    const e12 = ema(closes.slice(0, i), 12);
    const e26 = ema(closes.slice(0, i), 26);
    if (e12 != null && e26 != null) macdValues.push(e12 - e26);
  }
  const signal = ema(macdValues, 9) ?? macdLine;
  return { macd: macdLine, signal, hist: macdLine - signal };
}

function bollingerBands(closes: number[], period = 20, mult = 2): { upper: number; middle: number; lower: number; width: number } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  const upper = mean + mult * std;
  const lower = mean - mult * std;
  return { upper, middle: mean, lower, width: upper - lower };
}

function findSupportResistance(candles: { high: number; low: number; close: number }[], lookback = 50): { support: number; resistance: number } | null {
  if (candles.length < 10) return null;
  const slice = candles.slice(-lookback);
  // Simple pivot points
  const highs = slice.map(c => c.high);
  const lows = slice.map(c => c.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  return { support, resistance };
}

// ── Module ────────────────────────────────────────────────

export const technicalModule: AnalysisModule = {
  name: "technical",
  description: "Classical TA: EMA alignment, RSI, MACD, Bollinger Bands, S/R",
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
        module: "technical",
        description: this.description,
        direction: "neutral",
        strength: 0,
        confidence: 0.1,
        uncertainty: 1,
        evidence: [{ type: "neutral", label: "Insufficient Data", value: `${closes.length} candles`, detail: "Need at least 30 candles for technical analysis." }],
        veto: false,
        metrics: { candleCount: closes.length },
        analyzedAt: input.now,
      };
    }

    const price = input.livePrice;

    // ── EMA Alignment ──
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const ema200 = closes.length >= 200 ? ema(closes, 200) : null;

    if (ema20 != null && ema50 != null) {
      const emaAligned = input.side === "long" ? ema20 > ema50 : ema20 < ema50;
      const priceAboveEma = input.side === "long" ? price > ema20 : price < ema20;
      metrics.ema20 = ema20;
      metrics.ema50 = ema50;
      metrics.emaAlignment = emaAligned ? 1 : 0;

      if (emaAligned) {
        bullishPoints += input.side === "long" ? 2 : 0;
        bearishPoints += input.side === "short" ? 2 : 0;
        evidence.push({
          type: "supporting",
          label: "EMA Alignment",
          value: `EMA20 ${input.side === "long" ? ">" : "<"} EMA50`,
          detail: `EMA20=${ema20.toFixed(2)}, EMA50=${ema50.toFixed(2)}. ${input.side === "long" ? "Bullish" : "Bearish"} crossover aligned.`,
        });
      } else {
        evidence.push({
          type: "contradicting",
          label: "EMA Misalignment",
          value: `EMA20 ${ema20 > ema50 ? ">" : "<"} EMA50`,
          detail: `EMA alignment opposes ${input.side} direction.`,
        });
      }
      totalPoints += 2;
    }

    if (ema50 != null && ema200 != null) {
      metrics.ema200 = ema200;
      const longTermBull = ema50 > ema200;
      const longTermAligned = input.side === "long" ? longTermBull : !longTermBull;
      if (longTermAligned) {
        bullishPoints += input.side === "long" ? 1 : 0;
        bearishPoints += input.side === "short" ? 1 : 0;
        evidence.push({
          type: "supporting",
          label: "Long-Term Trend",
          value: `EMA50 ${longTermBull ? ">" : "<"} EMA200`,
          detail: "Higher timeframe trend agrees with trade direction.",
        });
      } else {
        evidence.push({
          type: "contradicting",
          label: "Long-Term Trend Opposes",
          value: `EMA50 ${longTermBull ? ">" : "<"} EMA200`,
          detail: "Longer-term trend structure conflicts with trade direction.",
        });
      }
      totalPoints += 1;
    }

    // ── RSI ──
    const rsiVal = rsi(closes, 14);
    if (rsiVal != null) {
      metrics.rsi = rsiVal;
      const rsiBullish = input.side === "long" ? rsiVal > 50 && rsiVal < 75 : rsiVal < 50 && rsiVal > 25;
      const rsiNeutral = rsiVal >= 30 && rsiVal <= 70;

      if (rsiBullish) {
        bullishPoints += input.side === "long" ? 2 : 0;
        bearishPoints += input.side === "short" ? 2 : 0;
        evidence.push({
          type: "supporting",
          label: "RSI Momentum",
          value: `RSI=${rsiVal.toFixed(1)}`,
          detail: `RSI in ${input.side === "long" ? "bullish" : "bearish"} zone. Momentum confirms direction.`,
        });
      } else if (rsiVal > 75) {
        evidence.push({
          type: "contradicting",
          label: "RSI Overbought",
          value: `RSI=${rsiVal.toFixed(1)}`,
          detail: "Overbought — risk of mean reversion against position.",
        });
      } else if (rsiVal < 25) {
        evidence.push({
          type: "contradicting",
          label: "RSI Oversold",
          value: `RSI=${rsiVal.toFixed(1)}`,
          detail: "Oversold — risk of bounce against short position.",
        });
      } else {
        evidence.push({
          type: "neutral",
          label: "RSI Neutral",
          value: `RSI=${rsiVal.toFixed(1)}`,
          detail: "RSI in neutral zone — no strong momentum signal.",
        });
      }
      totalPoints += 2;
    }

    // ── MACD ──
    const macdVal = macd(closes);
    if (macdVal) {
      metrics.macdLine = macdVal.macd;
      metrics.macdSignal = macdVal.signal;
      metrics.macdHist = macdVal.hist;
      const macdBullish = macdVal.hist > 0;
      const macdAligned = input.side === "long" ? macdBullish : !macdBullish;

      if (macdAligned) {
        bullishPoints += input.side === "long" ? 1.5 : 0;
        bearishPoints += input.side === "short" ? 1.5 : 0;
        evidence.push({
          type: "supporting",
          label: "MACD Confirmation",
          value: `MACD hist=${macdVal.hist.toFixed(4)}`,
          detail: `MACD ${macdBullish ? "above" : "below"} signal line — ${input.side === "long" ? "bullish" : "bearish"} momentum.`,
        });
      } else {
        evidence.push({
          type: "contradicting",
          label: "MACD Divergence",
          value: `MACD hist=${macdVal.hist.toFixed(4)}`,
          detail: "MACD histogram opposes trade direction.",
        });
      }
      totalPoints += 1.5;
    }

    // ── Bollinger Bands ──
    const bb = bollingerBands(closes);
    if (bb) {
      metrics.bbUpper = bb.upper;
      metrics.bbLower = bb.lower;
      metrics.bbWidth = bb.width;
      const bbPct = (price - bb.lower) / (bb.upper - bb.lower);
      metrics.bbPosition = bbPct;

      if (bbPct > 0.7 && input.side === "long") {
        bullishPoints += 1;
        evidence.push({
          type: "supporting",
          label: "Bollinger Position",
          value: `Position ${(bbPct * 100).toFixed(0)}% within bands`,
          detail: "Price in upper band — trending strength.",
        });
      } else if (bbPct < 0.3 && input.side === "short") {
        bearishPoints += 1;
        evidence.push({
          type: "supporting",
          label: "Bollinger Position",
          value: `Position ${(bbPct * 100).toFixed(0)}% within bands`,
          detail: "Price in lower band — downtrend strength.",
        });
      } else {
        evidence.push({
          type: "neutral",
          label: "Bollinger Position",
          value: `Position ${(bbPct * 100).toFixed(0)}% within bands`,
          detail: "Price in mid-range of Bollinger Bands.",
        });
      }
      totalPoints += 1;
    }

    // ── Support/Resistance ──
    const sr = findSupportResistance(input.candles15m);
    if (sr) {
      metrics.support = sr.support;
      metrics.resistance = sr.resistance;
      const distToSupport = ((price - sr.support) / price) * 100;
      const distToResistance = ((sr.resistance - price) / price) * 100;
      metrics.distToSupportPct = distToSupport;
      metrics.distToResistancePct = distToResistance;

      if (input.side === "long" && distToResistance > 2) {
        bullishPoints += 1;
        evidence.push({
          type: "supporting",
          label: "Room to Resistance",
          value: `${distToResistance.toFixed(1)}% to resistance`,
          detail: `Resistance at ${sr.resistance.toFixed(2)} — ample room for upside.`,
        });
      } else if (input.side === "short" && distToSupport > 2) {
        bearishPoints += 1;
        evidence.push({
          type: "supporting",
          label: "Room to Support",
          value: `${distToSupport.toFixed(1)}% to support`,
          detail: `Support at ${sr.support.toFixed(2)} — ample room for downside.`,
        });
      } else {
        evidence.push({
          type: "contradicting",
          label: "Near Key Level",
          value: `${input.side === "long" ? distToResistance : distToSupport}% to ${input.side === "long" ? "resistance" : "support"}`,
          detail: "Price near a key structural level — reduced upside/downside.",
        });
      }
      totalPoints += 1;
    }

    // ── Aggregate ──
    const rawScore = totalPoints > 0 ? (bullishPoints - bearishPoints) / totalPoints : 0;
    const strength = Math.abs(rawScore);
    const direction = rawScore > 0.1 ? "bullish" : rawScore < -0.1 ? "bearish" : "neutral";
    const agreementRatio = totalPoints > 0 ? Math.max(bullishPoints, bearishPoints) / totalPoints : 0.5;
    const confidence = Math.min(0.95, Math.max(0.1, agreementRatio * (closes.length >= 100 ? 1 : closes.length / 100)));
    const uncertainty = Math.max(0.05, 1 - confidence);

    return {
      module: "technical",
      description: this.description,
      direction,
      strength: Math.min(1, strength),
      confidence,
      uncertainty,
      evidence,
      veto: false,
      metrics,
      analyzedAt: input.now,
    };
  },
};
