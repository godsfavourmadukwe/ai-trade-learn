// ============================================================
// AI TRADE ARENA — Volume / Liquidity Analysis Module
//
// Analyzes volume profile, volume trend, OBV, volume-price
// divergence, and liquidity assessment.
// Volume confirms or denies the validity of price moves.
// ============================================================

import type { AnalysisModule, ModuleInput, ModuleOutput, EvidenceItem } from "./types";

function volumeMA(volumes: number[], period: number): number | null {
  if (volumes.length < period) return null;
  return volumes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function obv(closes: number[], volumes: number[]): number[] {
  if (closes.length < 2) return [];
  const result = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) result.push(result[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) result.push(result[i - 1] - volumes[i]);
    else result.push(result[i - 1]);
  }
  return result;
}

function volumeZScore(volumes: number[]): number | null {
  if (volumes.length < 20) return null;
  const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const std = Math.sqrt(volumes.reduce((s, v) => s + (v - mean) ** 2, 0) / volumes.length);
  if (std === 0) return 0;
  return (volumes[volumes.length - 1] - mean) / std;
}

export const volumeModule: AnalysisModule = {
  name: "volume",
  description: "Volume analysis: OBV, volume trend, volume-price confirmation, liquidity",
  weight: 0.13,

  analyze(input: ModuleInput): ModuleOutput {
    const evidence: EvidenceItem[] = [];
    const metrics: Record<string, number> = {};

    const candles = input.candles15m;
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);

    if (closes.length < 20) {
      return {
        module: "volume",
        description: this.description,
        direction: "neutral",
        strength: 0,
        confidence: 0.1,
        uncertainty: 1,
        evidence: [{ type: "neutral", label: "Insufficient Data", value: `${closes.length} candles`, detail: "Need at least 20 candles for volume analysis." }],
        veto: false,
        metrics: { candleCount: closes.length },
        analyzedAt: input.now,
      };
    }

    const price = input.livePrice;

    // ── Volume Moving Average ──
    const volMa10 = volumeMA(volumes, 10);
    const volMa20 = volumeMA(volumes, 20);
    const currentVol = volumes[volumes.length - 1];
    const volRatio20 = volMa20 && volMa20 > 0 ? currentVol / volMa20 : null;
    const volRatio10 = volMa10 && volMa10 > 0 ? currentVol / volMa10 : null;
    if (volRatio20 != null) metrics.volumeVsMa20 = volRatio20;
    if (volRatio10 != null) metrics.volumeVsMa10 = volRatio10;

    // ── Volume Z-Score ──
    const volZ = volumeZScore(volumes);
    if (volZ != null) metrics.volumeZScore = volZ;

    // ── OBV Trend ──
    const obvValues = obv(closes, volumes);
    let obvTrend = 0;
    if (obvValues.length >= 20) {
      const obvSma20 = obvValues.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const obvSma5 = obvValues.slice(-5).reduce((a, b) => a + b, 0) / 5;
      obvTrend = obvSma20 !== 0 ? (obvSma5 - obvSma20) / Math.abs(obvSma20) : 0;
      metrics.obvTrend = obvTrend;
    }

    // ── Volume-Price Confirmation ──
    // Rising price + rising volume = confirmed
    // Rising price + falling volume = divergent (weak)
    const priceUp = closes[closes.length - 1] > closes[closes.length - 6];
    const volUp = volRatio10 != null ? volRatio10 > 1 : currentVol > (volMa10 ?? 0);
    const volPriceConfirmed = (priceUp && volUp) || (!priceUp && !volUp);
    metrics.volPriceConfirm = volPriceConfirmed ? 1 : 0;

    // ── Accumulation/Distribution approximation ──
    let adSum = 0;
    for (let i = Math.max(0, candles.length - 20); i < candles.length; i++) {
      const range = candles[i].high - candles[i].low;
      if (range > 0) {
        const clv = ((candles[i].close - candles[i].low) - (candles[i].high - candles[i].close)) / range;
        adSum += clv * candles[i].volume;
      }
    }
    metrics.adLine = adSum;

    // ── Evidence ──

    // Volume ratio
    if (volRatio20 != null) {
      if (volRatio20 > 2) {
        evidence.push({
          type: "supporting",
          label: "Exceptional Volume",
          value: `${volRatio20.toFixed(2)}x average`,
          detail: "Volume significantly above average — strong participation confirms the move.",
        });
      } else if (volRatio20 > 1.2) {
        evidence.push({
          type: "supporting",
          label: "Above-Average Volume",
          value: `${volRatio20.toFixed(2)}x average`,
          detail: "Volume above average — supports the directional move.",
        });
      } else if (volRatio20 < 0.5) {
        evidence.push({
          type: "contradicting",
          label: "Low Volume",
          value: `${volRatio20.toFixed(2)}x average`,
          detail: "Volume well below average — price move lacks participation.",
        });
      } else {
        evidence.push({
          type: "neutral",
          label: "Normal Volume",
          value: `${volRatio20.toFixed(2)}x average`,
          detail: "Volume near average levels.",
        });
      }
    }

    // OBV trend
    if (obvTrend !== 0) {
      const obvAligned = input.side === "long" ? obvTrend > 0 : obvTrend < 0;
      evidence.push({
        type: obvAligned ? "supporting" : "contradicting",
        label: "OBV Trend",
        value: `${obvTrend > 0 ? "Rising" : "Falling"} (${(obvTrend * 100).toFixed(1)}%)`,
        detail: obvAligned
          ? "On-Balance Volume confirms accumulation/distribution in trade direction."
          : "OBV divergence — volume flow opposes price direction.",
      });
    }

    // Volume-price confirmation
    if (!volPriceConfirmed) {
      evidence.push({
        type: "contradicting",
        label: "Volume-Price Divergence",
        value: priceUp ? "Price up, vol down" : "Price down, vol up",
        detail: "Price moving without volume confirmation — potential false move.",
      });
    } else {
      evidence.push({
        type: "supporting",
        label: "Volume-Price Confirmed",
        value: "Price and volume aligned",
        detail: "Price move confirmed by volume direction.",
      });
    }

    // Volume Z-score
    if (volZ != null) {
      if (volZ > 2) {
        evidence.push({
          type: "supporting",
          label: "Volume Spike",
          value: `Z-score: ${volZ.toFixed(1)}`,
          detail: "Volume is statistically unusual — high conviction move.",
        });
      } else if (volZ < -1.5) {
        evidence.push({
          type: "contradicting",
          label: "Volume Dry",
          value: `Z-score: ${volZ.toFixed(1)}`,
          detail: "Volume unusually low — market uninterested in current direction.",
        });
      }
    }

    // Liquidity assessment from ticker
    if (input.ticker) {
      const quoteVol = input.ticker.quoteVolume24h;
      metrics.liquidity24h = quoteVol;
      if (quoteVol < 5_000_000) {
        evidence.push({
          type: "contradicting",
          label: "Low Liquidity",
          value: `$${(quoteVol / 1e6).toFixed(1)}M 24h`,
          detail: "Low 24h quote volume — slippage risk is elevated.",
        });
      } else {
        evidence.push({
          type: "supporting",
          label: "Adequate Liquidity",
          value: `$${(quoteVol / 1e6).toFixed(1)}M 24h`,
          detail: "Sufficient 24h volume for execution.",
        });
      }
    }

    // ── Aggregate ──
    let supporting = 0, contradicting = 0;
    for (const e of evidence) {
      if (e.type === "supporting") supporting++;
      else if (e.type === "contradicting") contradicting++;
    }
    const total = supporting + contradicting;
    const rawScore = total > 0 ? (supporting - contradicting) / total : 0;
    const direction = rawScore > 0.2 ? "bullish" : rawScore < -0.2 ? "bearish" : "neutral";
    const confidence = total > 0 ? Math.min(0.9, 0.3 + (Math.max(supporting, contradicting) / total) * 0.5) : 0.3;
    const uncertainty = 1 - confidence;

    return {
      module: "volume",
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
