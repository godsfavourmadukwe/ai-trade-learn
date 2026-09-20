// ============================================================
// AI TRADE ARENA — Market Context Analysis Module
//
// Evaluates broader market context: cross-asset correlation,
// 24h price structure, time-of-day patterns, and gap analysis.
// Provides contextual evidence without requiring news feeds.
// ============================================================

import type { AnalysisModule, ModuleInput, ModuleOutput, EvidenceItem } from "./types";

export const contextModule: AnalysisModule = {
  name: "context",
  description: "Market context: 24h structure, session timing, gap analysis, multi-period",
  weight: 0.10,

  analyze(input: ModuleInput): ModuleOutput {
    const evidence: EvidenceItem[] = [];
    const metrics: Record<string, number> = {};

    if (input.livePrice <= 0 || !input.ticker) {
      return {
        module: "context",
        description: this.description,
        direction: "neutral",
        strength: 0,
        confidence: 0.1,
        uncertainty: 0.9,
        evidence: [{ type: "neutral", label: "No Context Data", value: "N/A", detail: "Ticker data unavailable for context analysis." }],
        veto: false,
        metrics: {},
        analyzedAt: input.now,
      };
    }

    const ticker = input.ticker;
    const price = input.livePrice;

    // ── 24h Price Structure ──
    const change24h = ticker.change24hPercent;
    metrics.change24h = change24h;

    const distFromHigh = ticker.high24h > 0 ? ((ticker.high24h - price) / ticker.high24h) * 100 : null;
    const distFromLow = ticker.low24h > 0 ? ((price - ticker.low24h) / ticker.low24h) * 100 : null;
    if (distFromHigh != null) metrics.distFromHigh24hPct = distFromHigh;
    if (distFromLow != null) metrics.distFromLow24hPct = distFromLow;

    // 24h range
    const range24hPct = ticker.high24h > 0 && ticker.low24h > 0
      ? ((ticker.high24h - ticker.low24h) / ticker.low24h) * 100
      : null;
    if (range24hPct != null) metrics.range24hPct = range24hPct;

    // Position within 24h range (0 = at low, 1 = at high)
    const rangePosition = ticker.high24h > ticker.low24h && ticker.high24h > 0
      ? (price - ticker.low24h) / (ticker.high24h - ticker.low24h)
      : 0.5;
    metrics.rangePosition = rangePosition;

    // ── Evidence: 24h Structure ──
    if (change24h > 2) {
      evidence.push({
        type: input.side === "long" ? "supporting" : "contradicting",
        label: "24h Trend Strong Up",
        value: `+${change24h.toFixed(2)}%`,
        detail: "Strong 24h gains — momentum may continue or exhaust.",
      });
    } else if (change24h < -2) {
      evidence.push({
        type: input.side === "short" ? "supporting" : "contradicting",
        label: "24h Trend Strong Down",
        value: `${change24h.toFixed(2)}%`,
        detail: "Strong 24h decline — momentum may continue or bounce.",
      });
    } else if (Math.abs(change24h) < 0.5) {
      evidence.push({
        type: "neutral",
        label: "24h Flat",
        value: `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`,
        detail: "Minimal 24h movement — no strong directional context.",
      });
    } else {
      evidence.push({
        type: "neutral",
        label: "24h Moderate Move",
        value: `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`,
        detail: "Moderate 24h change — context is mixed.",
      });
    }

    // ── Range Position Evidence ──
    if (rangePosition > 0.8 && input.side === "long") {
      evidence.push({
        type: "contradicting",
        label: "Near 24h High",
        value: `Range position: ${(rangePosition * 100).toFixed(0)}%`,
        detail: "Price near 24h high — potential resistance or exhaustion.",
      });
    } else if (rangePosition < 0.2 && input.side === "short") {
      evidence.push({
        type: "contradicting",
        label: "Near 24h Low",
        value: `Range position: ${(rangePosition * 100).toFixed(0)}%`,
        detail: "Price near 24h low — potential support or bounce.",
      });
    } else if (rangePosition > 0.6) {
      evidence.push({
        type: input.side === "long" ? "supporting" : "neutral",
        label: "Upper Range",
        value: `Range position: ${(rangePosition * 100).toFixed(0)}%`,
        detail: "Price in upper half of 24h range — shows relative strength.",
      });
    } else if (rangePosition < 0.4) {
      evidence.push({
        type: input.side === "short" ? "supporting" : "neutral",
        label: "Lower Range",
        value: `Range position: ${(rangePosition * 100).toFixed(0)}%`,
        detail: "Price in lower half of 24h range — shows relative weakness.",
      });
    }

    // ── Session Timing ──
    const hour = new Date(input.now).getUTCHours();
    const isAsianSession = hour >= 0 && hour < 8;
    const isEuropeanSession = hour >= 7 && hour < 16;
    const isUSTSession = hour >= 13 && hour < 22;
    const session = isUSTSession ? "US" : isEuropeanSession ? "EU" : isAsianSession ? "ASIA" : "OFF";
    metrics.sessionHour = hour;
    metrics.isHighLiquiditySession = (isEuropeanSession || isUSTSession) ? 1 : 0;

    if (isEuropeanSession || isUSTSession) {
      evidence.push({
        type: "supporting",
        label: "Active Session",
        value: `${session} session (UTC ${hour}:00)`,
        detail: "Active trading session — liquidity and volume typically higher.",
      });
    } else {
      evidence.push({
        type: "neutral",
        label: "Off-Peak Session",
        value: `${session} session (UTC ${hour}:00)`,
        detail: "Lower liquidity session — wider spreads possible.",
      });
    }

    // ── Volume Context ──
    if (ticker.quoteVolume24h > 0) {
      metrics.quotVolume24h = ticker.quoteVolume24h;
      const volB = ticker.quoteVolume24h / 1e9;
      if (volB > 1) {
        evidence.push({
          type: "supporting",
          label: "High Volume Pair",
          value: `$${volB.toFixed(2)}B 24h`,
          detail: "Very high 24h volume — excellent liquidity.",
        });
      } else if (volB > 0.1) {
        evidence.push({
          type: "supporting",
          label: "Moderate Volume",
          value: `$${(ticker.quoteVolume24h / 1e6).toFixed(0)}M 24h`,
          detail: "Adequate 24h volume for trading.",
        });
      }
    }

    // ── Multi-timeframe agreement context ──
    const closes1h = input.candles1h.map(c => c.close);
    const closes15m = input.candles15m.map(c => c.close);
    if (closes1h.length >= 10 && closes15m.length >= 10) {
      const htfDirection = closes1h[closes1h.length - 1] > closes1h[closes1h.length - 6] ? "up" : "down";
      const ltfDirection = closes15m[closes15m.length - 1] > closes15m[closes15m.length - 6] ? "up" : "down";
      const mtfAgreement = htfDirection === ltfDirection;
      metrics.mtfAgreement = mtfAgreement ? 1 : 0;

      if (mtfAgreement) {
        evidence.push({
          type: "supporting",
          label: "Multi-TF Alignment",
          value: `15m and 1h both ${htfDirection}`,
          detail: "Short and medium timeframes agree on direction.",
        });
      } else {
        evidence.push({
          type: "contradicting",
          label: "Multi-TF Divergence",
          value: `15m ${ltfDirection}, 1h ${htfDirection}`,
          detail: "Timeframe divergence — lower confidence in direction.",
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
    const confidence = total > 0 ? Math.min(0.85, 0.3 + (Math.max(supporting, contradicting) / total) * 0.4) : 0.3;
    const uncertainty = 1 - confidence;

    return {
      module: "context",
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
