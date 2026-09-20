// ============================================================
// AI TRADE ARENA — Volatility Analysis Module
//
// Analyzes volatility regime via ATR, Bollinger Band width,
// realized vs implied volatility, and volatility clustering.
// Determines if current volatility is tradeable.
// ============================================================

import type { AnalysisModule, ModuleInput, ModuleOutput, EvidenceItem } from "./types";

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

function realizedVolatility(closes: number[], period = 20): number | null {
  if (closes.length < period + 1) return null;
  const returns: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 365); // annualized
}

function bollingerWidth(closes: number[], period = 20): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return mean > 0 ? (std * 2) / mean : null;
}

function atrPercentile(atrValues: number[], currentAtr: number): number {
  if (atrValues.length === 0) return 0.5;
  const below = atrValues.filter(v => v < currentAtr).length;
  return below / atrValues.length;
}

export const volatilityModule: AnalysisModule = {
  name: "volatility",
  description: "Volatility regime: ATR analysis, realized vol, BB width, clustering",
  weight: 0.12,

  analyze(input: ModuleInput): ModuleOutput {
    const evidence: EvidenceItem[] = [];
    const metrics: Record<string, number> = {};

    const closes = input.candles15m.map(c => c.close);
    if (closes.length < 30 || input.livePrice <= 0) {
      return {
        module: "volatility",
        description: this.description,
        direction: "neutral",
        strength: 0,
        confidence: 0.1,
        uncertainty: 1,
        evidence: [{ type: "neutral", label: "Insufficient Data", value: `${closes.length} candles`, detail: "Need at least 30 candles for volatility analysis." }],
        veto: false,
        metrics: { candleCount: closes.length },
        analyzedAt: input.now,
      };
    }

    const price = input.livePrice;

    // ── ATR ──
    const atrVal = atr(input.candles15m, 14);
    const atrPct = atrVal && price > 0 ? (atrVal / price) * 100 : null;
    if (atrVal != null) metrics.atr14 = atrVal;
    if (atrPct != null) metrics.atrPercent = atrPct;

    // ATR percentile (relative to recent history)
    const atrHistory: number[] = [];
    for (let i = 30; i <= input.candles15m.length; i++) {
      const a = atr(input.candles15m.slice(0, i), 14);
      if (a != null) atrHistory.push(a);
    }
    const atrPctile = atrVal != null ? atrPercentile(atrHistory, atrVal) : 0.5;
    metrics.atrPercentile = atrPctile;

    // ── Realized Volatility ──
    const realizedVol = realizedVolatility(closes, 20);
    if (realizedVol != null) metrics.realizedVol = realizedVol;

    // ── Bollinger Band Width ──
    const bbWidth = bollingerWidth(closes, 20);
    if (bbWidth != null) metrics.bbWidth = bbWidth;

    // ── Volatility regime classification ──
    let volRegime: "compressed" | "normal" | "elevated" | "extreme" = "normal";
    if (atrPct != null) {
      if (atrPct > 4) volRegime = "extreme";
      else if (atrPct > 2) volRegime = "elevated";
      else if (atrPct < 0.3) volRegime = "compressed";
      else volRegime = "normal";
    }
    metrics.volRegimeScore = volRegime === "compressed" ? 0 : volRegime === "normal" ? 0.5 : volRegime === "elevated" ? 0.8 : 1;

    // ── Volatility expansion/compression ──
    const recentAtr = atr(input.candles15m.slice(-20), 10);
    const olderAtr = atr(input.candles15m.slice(-40, -20), 10);
    let volExpansion = 0; // -1 = contracting, 0 = stable, +1 = expanding
    if (recentAtr != null && olderAtr != null && olderAtr > 0) {
      volExpansion = Math.max(-1, Math.min(1, (recentAtr - olderAtr) / olderAtr));
      metrics.volExpansion = volExpansion;
    }

    // ── Evidence ──

    // Volatility regime
    if (volRegime === "extreme") {
      evidence.push({
        type: "contradicting",
        label: "Extreme Volatility",
        value: `ATR=${atrPct?.toFixed(2)}% (${(atrPctile * 100).toFixed(0)}th percentile)`,
        detail: "Volatility extremely elevated — high risk of slippage and stop-hunts. Avoid new entries.",
      });
    } else if (volRegime === "compressed") {
      evidence.push({
        type: "contradicting",
        label: "Low Volatility",
        value: `ATR=${atrPct?.toFixed(2)}% (${(atrPctile * 100).toFixed(0)}th percentile)`,
        detail: "Volatility compressed — potential breakout building but direction unknown.",
      });
    } else if (volRegime === "elevated") {
      evidence.push({
        type: input.side === "long" ? "supporting" : "supporting",
        label: "Elevated Volatility",
        value: `ATR=${atrPct?.toFixed(2)}% (${(atrPctile * 100).toFixed(0)}th percentile)`,
        detail: "Volatility elevated but within range — trend moves likely. Use wider stops.",
      });
    } else {
      evidence.push({
        type: "supporting",
        label: "Normal Volatility",
        value: `ATR=${atrPct?.toFixed(2)}% (${(atrPctile * 100).toFixed(0)}th percentile)`,
        detail: "Volatility in normal range — suitable for trend-following entries.",
      });
    }

    // Volatility expansion
    if (volExpansion > 0.3) {
      evidence.push({
        type: "supporting",
        label: "Volatility Expanding",
        value: `Change: +${(volExpansion * 100).toFixed(0)}%`,
        detail: "Volatility is expanding — supports breakout continuation.",
      });
    } else if (volExpansion < -0.3) {
      evidence.push({
        type: "neutral",
        label: "Volatility Contracting",
        value: `Change: ${(volExpansion * 100).toFixed(0)}%`,
        detail: "Volatility contracting — potential for breakout or continued compression.",
      });
    }

    // BB width context
    if (bbWidth != null) {
      metrics.bbWidthPct = bbWidth * 100;
      if (bbWidth < 0.02) {
        evidence.push({
          type: "neutral",
          label: "BB Squeeze",
          value: `Width: ${(bbWidth * 100).toFixed(2)}%`,
          detail: "Bollinger Band squeeze — volatility compression often precedes expansion.",
        });
      }
    }

    // Realized vol context
    if (realizedVol != null) {
      evidence.push({
        type: "neutral",
        label: "Realized Volatility",
        value: `${(realizedVol * 100).toFixed(1)}% annualized`,
        detail: realizedVol > 1 ? "High annualized volatility." : realizedVol < 0.3 ? "Low annualized volatility." : "Moderate annualized volatility.",
      });
    }

    // ── Veto logic ──
    const veto = volRegime === "extreme";
    const vetoReason = veto ? "Volatility extreme — trading suspended to avoid excessive risk" : undefined;

    // ── Direction: volatility itself is directionally neutral
    // The module's role is to GATE trades, not to pick direction.
    // We lean slightly toward the trade direction if vol is expanding
    // in a favorable way, but mostly stay neutral.
    const direction = "neutral";
    const strength = volRegime === "extreme" || volRegime === "compressed" ? 0.8 : 0.3;
    const confidence = volRegime === "extreme" ? 0.9 : atrPct != null ? 0.7 : 0.4;
    const uncertainty = atrPct != null ? 0.2 : 0.6;

    return {
      module: "volatility",
      description: this.description,
      direction,
      strength,
      confidence,
      uncertainty,
      evidence,
      veto,
      vetoReason,
      metrics,
      analyzedAt: input.now,
    };
  },
};
