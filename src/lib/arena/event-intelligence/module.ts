// ============================================================
// AI TRADE ARENA — Event Intelligence Module
//
// 10th analysis module in the fusion pipeline. Evaluates
// event intelligence alongside quantitative modules.
//
// NEVER generates trades from headlines alone.
// Only influences confidence/direction — never forces a trade.
// ============================================================

import type {
  AnalysisModule,
  ModuleInput,
  ModuleOutput,
  ModuleDirection,
  EvidenceItem,
} from "../modules/types";
import {
  detectMarketEvents,
  aggregateEvents,
  storeEvent,
  getActiveEvents,
  checkEventConfirmation,
} from "./collector";
import type { EventIntelligence, MarketEvent } from "./types";

// ── Cached intelligence per symbol ────────────────────────

const intelCache = new Map<string, EventIntelligence>();

/**
 * Get cached event intelligence for a symbol, or compute fresh.
 */
export function getEventIntelligence(
  symbol: string,
  candles15m: ModuleInput["candles15m"],
  candles1h: ModuleInput["candles1h"],
  livePrice: number,
  ticker: ModuleInput["ticker"],
  side: "long" | "short",
  now: number,
): EventIntelligence {
  // Detect new events
  const detected = detectMarketEvents(
    symbol,
    candles15m,
    candles1h,
    livePrice,
    ticker ? {
      change24hPercent: ticker.change24hPercent,
      high24h: ticker.high24h,
      low24h: ticker.low24h,
      volume24h: ticker.quoteVolume24h,
      open24h: ticker.open24h,
    } : null,
    now,
  );

  // Store detected events
  for (const event of detected) {
    storeEvent(event);
  }

  // Check confirmations for existing events
  const existing = getActiveEvents(symbol);
  for (const event of existing) {
    const eventCandles = candles15m.filter(
      (c) => c.time > event.detectedAt && c.closed,
    );
    event.confirmation = checkEventConfirmation(event, eventCandles, now);
  }

  // Aggregate all events for this symbol
  const allEvents = [...detected, ...existing.filter((e) =>
    e.affectedAssets.some((a) => a.symbol === symbol || symbol.includes(a.symbol)),
  )];

  const intel = aggregateEvents(symbol, allEvents, side, now);
  intelCache.set(`${symbol}_${side}`, intel);
  return intel;
}

/**
 * Get cached event intelligence (sync, for fusion pipeline).
 */
export function getCachedEventIntelligence(
  symbol: string,
  side: "long" | "short",
): EventIntelligence | null {
  return intelCache.get(`${symbol}_${side}`) ?? null;
}

// ── Analysis Module Implementation ────────────────────────

const eventIntelligenceModule: AnalysisModule = {
  name: "event_intelligence",
  description: "Market event intelligence — news, technical alerts, volume anomalies, price shocks",
  weight: 0.15,

  analyze(input: ModuleInput): ModuleOutput {
    const now = input.now;
    const evidence: EvidenceItem[] = [];

    // Get event intelligence
    const intel = getEventIntelligence(
      input.symbol,
      input.candles15m,
      input.candles1h,
      input.livePrice,
      input.ticker,
      input.side,
      now,
    );

    // Determine direction from event intelligence
    let direction: ModuleDirection = "neutral";
    let strength = 0;
    let confidence = intel.confidence;
    let uncertainty = intel.uncertainty;
    let veto = false;
    let vetoReason: string | undefined;

    if (intel.eventCount === 0) {
      // No events — neutral
      direction = "neutral";
      strength = 0;
      confidence = 0.3;
      uncertainty = 0.5;
      evidence.push({
        type: "neutral",
        label: "No Events",
        value: "No significant market events detected",
        detail: "Market event intelligence layer found no relevant events for this symbol.",
        source: "event_intelligence",
      });
    } else {
      // Events present — evaluate directional alignment
      const sideSign = input.side === "long" ? 1 : -1;
      const alignedBias = intel.directionalBias * sideSign;

      if (alignedBias > 0.1) {
        direction = "bullish";
        strength = Math.min(1, alignedBias);
      } else if (alignedBias < -0.1) {
        direction = "bearish";
        strength = Math.min(1, Math.abs(alignedBias));
      } else {
        direction = "neutral";
        strength = Math.abs(alignedBias);
      }

      // Build evidence from factors
      for (const factor of intel.factors.slice(0, 5)) {
        const isAligned = (input.side === "long" && factor.lean > 0) ||
          (input.side === "short" && factor.lean < 0);
        const isContradicting = (input.side === "long" && factor.lean < 0) ||
          (input.side === "short" && factor.lean > 0);

        evidence.push({
          type: isAligned ? "supporting" : isContradicting ? "contradicting" : "neutral",
          label: factor.label,
          value: `Lean: ${factor.lean > 0 ? "bullish" : factor.lean < 0 ? "bearish" : "neutral"} (${(factor.weight * 100).toFixed(0)}%)`,
          detail: factor.detail,
          source: "event_intelligence",
          weight: factor.weight,
        });
      }

      // Confirmation evidence
      if (intel.confirmedCount > 0) {
        evidence.push({
          type: "supporting",
          label: "Event Confirmation",
          value: `${intel.confirmedCount}/${intel.eventCount} events confirmed by price action`,
          detail: "Market behavior confirms the expected impact of detected events.",
          source: "event_intelligence",
          weight: 0.5,
        });
      }

      if (intel.unconfirmedCount > 0) {
        evidence.push({
          type: "neutral",
          label: "Unconfirmed Events",
          value: `${intel.unconfirmedCount} events awaiting market confirmation`,
          detail: "Some events have not yet been confirmed by price/volume behavior.",
          source: "event_intelligence",
          weight: 0.3,
        });
      }

      // Veto check
      if (intel.veto) {
        veto = true;
        vetoReason = intel.vetoReason ?? "Multiple high-confidence events contradict the trade direction";
        evidence.push({
          type: "contradicting",
          label: "Event Veto",
          value: vetoReason,
          detail: "High-confidence contradicting events prevent this trade.",
          source: "event_intelligence",
          weight: 1.0,
        });
      }
    }

    // Build metrics
    const metrics: Record<string, number> = {
      eventCount: intel.eventCount,
      directionalBias: intel.directionalBias,
      confirmedCount: intel.confirmedCount,
      unconfirmedCount: intel.unconfirmedCount,
      eventConfidence: intel.confidence,
      eventUncertainty: intel.uncertainty,
    };

    return {
      module: "event_intelligence",
      description: "Market event intelligence from technical alerts, volume anomalies, price shocks, and 24h structure",
      direction,
      strength,
      confidence,
      uncertainty,
      evidence,
      veto,
      vetoReason,
      metrics,
      analyzedAt: now,
    };
  },
};

export { eventIntelligenceModule };
