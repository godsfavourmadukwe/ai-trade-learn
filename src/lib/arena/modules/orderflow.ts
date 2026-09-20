// ============================================================
// AI TRADE ARENA — Order Flow / Order Book Analysis Module
//
// Analyzes bid/ask imbalance, spread quality, and order book
// depth. When order book data is available, provides additional
// evidence for or against a trade. Gracefully degrades when
// order book data is unavailable.
// ============================================================

import type { AnalysisModule, ModuleInput, ModuleOutput, EvidenceItem } from "./types";

export const orderFlowModule: AnalysisModule = {
  name: "orderflow",
  description: "Order flow: bid/ask imbalance, spread analysis, book depth",
  weight: 0.10,

  analyze(input: ModuleInput): ModuleOutput {
    const evidence: EvidenceItem[] = [];
    const metrics: Record<string, number> = {};

    // ── No order book data — graceful degradation ──
    if (!input.orderBook) {
      return {
        module: "orderflow",
        description: this.description,
        direction: "neutral",
        strength: 0,
        confidence: 0.15,
        uncertainty: 0.85,
        evidence: [{
          type: "neutral",
          label: "No Order Book Data",
          value: "N/A",
          detail: "Order book data not available for this pair. Module abstains from voting.",
        }],
        veto: false,
        metrics: { dataAvailable: 0 },
        analyzedAt: input.now,
      };
    }

    const { bid, ask, bidQty, askQty, spreadBps } = input.orderBook;
    metrics.dataAvailable = 1;
    metrics.spreadBps = spreadBps;
    metrics.bid = bid;
    metrics.ask = ask;

    // ── Bid/Ask Imbalance ──
    const totalQty = bidQty + askQty;
    const imbalance = totalQty > 0 ? (bidQty - askQty) / totalQty : 0;
    metrics.bookImbalance = imbalance;

    const bidLean = imbalance > 0.2;   // significant bid pressure
    const askLean = imbalance < -0.2;  // significant ask pressure

    if (bidLean) {
      evidence.push({
        type: input.side === "long" ? "supporting" : "contradicting",
        label: "Bid Pressure",
        value: `Imbalance: ${(imbalance * 100).toFixed(1)}%`,
        detail: `Bids ${(imbalance * 100).toFixed(1)}% heavier — ${input.side === "long" ? "supports buying" : "opposes shorting"}.`,
      });
    } else if (askLean) {
      evidence.push({
        type: input.side === "short" ? "supporting" : "contradicting",
        label: "Ask Pressure",
        value: `Imbalance: ${(imbalance * 100).toFixed(1)}%`,
        detail: `Asks ${Math.abs(imbalance * 100).toFixed(1)}% heavier — ${input.side === "short" ? "supports selling" : "opposes longing"}.`,
      });
    } else {
      evidence.push({
        type: "neutral",
        label: "Balanced Book",
        value: `Imbalance: ${(imbalance * 100).toFixed(1)}%`,
        detail: "Order book is roughly balanced — no strong directional pressure.",
      });
    }

    // ── Spread Analysis ──
    metrics.spreadPct = spreadBps / 100;
    if (spreadBps < 3) {
      evidence.push({
        type: "supporting",
        label: "Tight Spread",
        value: `${spreadBps.toFixed(1)} bps`,
        detail: "Spread is tight — low execution cost.",
      });
    } else if (spreadBps > 15) {
      evidence.push({
        type: "contradicting",
        label: "Wide Spread",
        value: `${spreadBps.toFixed(1)} bps`,
        detail: "Spread is wide — high execution cost reduces expected value.",
      });
    } else {
      evidence.push({
        type: "neutral",
        label: "Normal Spread",
        value: `${spreadBps.toFixed(1)} bps`,
        detail: "Spread within normal range.",
      });
    }

    // ── Book Depth Ratio ──
    if (bidQty > 0 && askQty > 0) {
      const depthRatio = Math.max(bidQty, askQty) / Math.min(bidQty, askQty);
      metrics.depthRatio = depthRatio;
      if (depthRatio > 3) {
        const heavySide = bidQty > askQty ? "bid" : "ask";
        evidence.push({
          type: heavySide === "bid" && input.side === "long" ? "supporting" : heavySide === "ask" && input.side === "short" ? "supporting" : "contradicting",
          label: "Uneven Depth",
          value: `Ratio: ${depthRatio.toFixed(1)}x`,
          detail: `One side has ${depthRatio.toFixed(1)}x more depth — potential support/resistance.`,
        });
      }
    }

    // ── Spread vs Price Impact ──
    const price = input.livePrice;
    if (price > 0 && spreadBps > 0) {
      const spreadCostPct = spreadBps / 100;
      metrics.spreadCostPct = spreadCostPct;
      if (spreadCostPct > 0.5) {
        evidence.push({
          type: "contradicting",
          label: "High Spread Cost",
          value: `${spreadCostPct.toFixed(2)}% of price`,
          detail: "Spread cost will significantly erode any edge.",
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
    const confidence = total > 0 ? Math.min(0.85, 0.4 + (Math.max(supporting, contradicting) / total) * 0.3) : 0.4;
    const uncertainty = 1 - confidence;

    return {
      module: "orderflow",
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
