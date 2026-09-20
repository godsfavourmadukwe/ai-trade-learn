// ============================================================
// AI TRADE ARENA — Cross-Market Analysis Module
//
// A standard AnalysisModule (same contract as technical,
// momentum, etc.) that consumes the precomputed CrossMarketContext
// from the cross-market intelligence layer and turns it into
// fusion evidence.
//
// CONFIRM  → supporting evidence (small confidence boost)
// CONTRADICT → contradicting evidence + veto-capable when confident
// NEUTRAL / insufficient data → neutral evidence, no veto
//
// Never forces a trade. Missing context is explicitly neutral.
// ============================================================

import type { AnalysisModule, ModuleInput, ModuleOutput, EvidenceItem } from "./types";
import { getCachedCrossMarketContext } from "../cross-market";
import type { CrossMarketContext, CrossMarketVerdict, RelatedMarket } from "../cross-market/types";

/** Verdict → evidence type mapping for a given side. */
function evidenceTypeFor(verdict: CrossMarketVerdict, side: "long" | "short"): EvidenceItem["type"] {
  if (verdict === "confirm") return "supporting";
  if (verdict === "contradict") return "contradicting";
  return "neutral";
}

export const crossMarketModule: AnalysisModule = {
  name: "cross_market",
  description:
    "Cross-market intelligence: correlated assets, market breadth, relative strength, cross-market volatility and market-wide trend",
  weight: 0.12,

  analyze(input: ModuleInput): ModuleOutput {
    const context: CrossMarketContext | null = getCachedCrossMarketContext(
      input.exchangeSymbol,
      input.side,
    );

    // ── No context available → explicitly neutral ──
    if (!context) {
      return {
        module: "cross_market",
        description: this.description,
        direction: "neutral",
        strength: 0,
        confidence: 0.1,
        uncertainty: 0.9,
        evidence: [
          {
            type: "neutral",
            label: "Cross-Market Data Unavailable",
            value: "N/A",
            detail:
              "Cross-market context has not been computed yet for this pair. Module remains neutral — no trade influence either way.",
            source: "cross_market_engine",
          },
        ],
        veto: false,
        metrics: {},
        analyzedAt: input.now,
      };
    }

    const evidence: EvidenceItem[] = [];

    // ── Headline verdict evidence ──
    evidence.push({
      type: evidenceTypeFor(context.verdict, input.side),
      label:
        context.verdict === "confirm"
          ? "Cross-Market Confirmation"
          : context.verdict === "contradict"
            ? "Cross-Market Contradiction"
            : context.verdict === "neutral"
              ? "Cross-Market Neutral"
              : "Cross-Market Insufficient Data",
      value:
        context.verdict === "confirm"
          ? `+${(context.strength * 100).toFixed(0)}`
          : context.verdict === "contradict"
            ? `−${(context.strength * 100).toFixed(0)}`
            : "0",
      detail: context.summary,
      source: "cross_market_engine",
      weight: context.verdict === "contradict" ? 1.2 : 1, // contradictions weigh slightly more
    });

    // ── Related markets detail (top 3 by |correlation|) ──
    const topRelated: RelatedMarket[] = context.relatedMarkets
      .slice()
      .sort((a, b) => Math.abs(b.correlation ?? 0) - Math.abs(a.correlation ?? 0))
      .slice(0, 3);
    for (const rel of topRelated) {
      const corrStr = rel.correlation != null ? rel.correlation.toFixed(2) : "n/a";
      evidence.push({
        type: "neutral",
        label: `Related: ${rel.symbol}`,
        value: `ρ=${corrStr} · ${rel.change24hPercent >= 0 ? "+" : ""}${rel.change24hPercent.toFixed(2)}%`,
        detail: `${rel.reason}. Selected dynamically by correlation and liquidity.`,
        source: "cross_market_universe",
      });
    }

    // ── Factor evidence (confirm/contradict factors only) ──
    for (const f of context.factors) {
      if (f.lean === "unavailable") continue;
      evidence.push({
        type: f.lean === "confirm" ? "supporting" : f.lean === "contradict" ? "contradicting" : "neutral",
        label: f.factor
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase()),
        value: f.lean,
        detail: f.detail,
        source: "cross_market_engine",
      });
    }

    // ── Aggregate ──
    let supporting = 0;
    let contradicting = 0;
    for (const e of evidence) {
      if (e.type === "supporting") supporting++;
      else if (e.type === "contradicting") contradicting++;
    }

    const total = supporting + contradicting;
    const rawScore = total > 0 ? (supporting - contradicting) / total : 0;

    const direction =
      context.verdict === "confirm"
        ? "bullish"
        : context.verdict === "contradict"
          ? "bearish"
          : "neutral";

    // Direction relative to side: "bullish" supports a long, "bearish" supports a short.
    // For a short setup the module must express the opposite polarity so the
    // fusion engine classifies support/contradiction correctly.
    const polarityAdjusted: ModuleOutput["direction"] =
      input.side === "short"
        ? direction === "bullish"
          ? "bearish"
          : direction === "bearish"
            ? "bullish"
            : "neutral"
        : direction;

    // Strength/confidence follow the verdict quality
    const strength = context.strength;
    const confidence = context.dataAvailable
      ? Math.max(0.15, Math.min(0.8, context.confidence))
      : 0.15;
    const uncertainty = 1 - confidence;

    // Veto: only when the context confidently contradicts a confident setup.
    // Never vetoes on missing/neutral data.
    const veto =
      context.verdict === "contradict" &&
      context.confidence >= 0.6 &&
      context.strength >= 0.5;

    const metrics: Record<string, number> = {
      verdictScore: context.score,
      verdictStrength: context.strength,
      verdictConfidence: context.confidence,
      relatedMarketCount: context.relatedMarkets.length,
    };
    if (context.breadth) {
      metrics.breadthAdvancingRatio = context.breadth.advancingRatio;
      metrics.breadthDispersion = context.breadth.dispersion;
    }
    if (context.volatility?.relativeVol != null) {
      metrics.relativeVol = context.volatility.relativeVol;
    }

    return {
      module: "cross_market",
      description: this.description,
      direction: polarityAdjusted,
      strength,
      confidence,
      uncertainty,
      evidence,
      veto,
      vetoReason: veto
        ? `Cross-market context confidently contradicts the ${input.side} setup: ${context.summary}`
        : undefined,
      metrics,
      analyzedAt: input.now,
    };
  },
};
