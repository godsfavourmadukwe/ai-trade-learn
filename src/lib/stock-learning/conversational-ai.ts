// ============================================================
// STOCK MARKET LEARNING — Conversational Trading AI
//
// The AI users interact with. Combines:
//   - Current live market data
//   - Historical behavior from knowledge base
//   - Learned patterns
//   - Current market regime
//   - Risk analysis
//   - Validated model outputs
//   - User's own analysis/input
//
// Explains reasoning and clearly distinguishes:
//   DATA | MODEL INFERENCE | UNCERTAINTY
//
// Knowledge flows FORWARD ONLY — this AI never feeds
// information backward into historical tests.
// ============================================================

import type {
  AIQuery,
  AIResponse,
  AIDataPoint,
  KnowledgeEntry,
} from "./types";
import type { MarketRegime } from "@/lib/arena/types";
import {
  getKnowledgeForSymbol,
  getKnowledgeForRegime,
  getTopKnowledge,
} from "./knowledge-base";

// ── Response Generation ───────────────────────────────────

/**
 * Generate an AI response to a user query about a stock/asset.
 * Combines all available intelligence sources while clearly
 * distinguishing data from inference.
 */
export function generateAIResponse(query: AIQuery): AIResponse {
  const supportingData: AIDataPoint[] = [];
  const contradictingData: AIDataPoint[] = [];
  const uncertainties: string[] = [];

  // 1. Live data analysis
  for (const [symbol, data] of Object.entries(query.liveData)) {
    if (data.change24h > 3) {
      supportingData.push({
        label: `${symbol} strong positive momentum`,
        value: `+${data.change24h.toFixed(1)}% in 24h`,
        source: "live_data",
        weight: 0.3,
        detail: `${symbol} is showing significant upward momentum in the last 24 hours.`,
      });
    } else if (data.change24h < -3) {
      contradictingData.push({
        label: `${symbol} under pressure`,
        value: `${data.change24h.toFixed(1)}% in 24h`,
        source: "live_data",
        weight: 0.3,
        detail: `${symbol} is experiencing selling pressure in the last 24 hours.`,
      });
    }
  }

  // 2. Knowledge base lookup
  const allKnowledge: KnowledgeEntry[] = [];
  for (const symbol of query.symbols) {
    allKnowledge.push(...getKnowledgeForSymbol(symbol));
  }

  for (const knowledge of allKnowledge.slice(0, 10)) {
    const isPositive = knowledge.performance.winRate > 0.5 && knowledge.performance.avgSharpe > 0;
    const dataPoint: AIDataPoint = {
      label: knowledge.name,
      value: `Win rate: ${(knowledge.performance.winRate * 100).toFixed(0)}%, Sharpe: ${knowledge.performance.avgSharpe.toFixed(2)}`,
      source: "knowledge_base",
      weight: knowledge.confidence * 0.4,
      detail: knowledge.description,
    };

    if (isPositive) {
      supportingData.push(dataPoint);
    } else {
      contradictingData.push(dataPoint);
    }
  }

  // 3. Regime intelligence
  for (const [symbol, regime] of Object.entries(query.currentRegime)) {
    const regimeKnowledge = getKnowledgeForRegime(regime);
    if (regimeKnowledge.length > 0) {
      const avgWinRate = regimeKnowledge.reduce((s, k) => s + k.performance.winRate, 0) / regimeKnowledge.length;
      const dataPoint: AIDataPoint = {
        label: `${symbol} regime: ${regime.replace(/_/g, " ")}`,
        value: `${regimeKnowledge.length} patterns known, avg win rate: ${(avgWinRate * 100).toFixed(0)}%`,
        source: "regime_intelligence",
        weight: 0.25,
        detail: `Current market regime for ${symbol} is ${regime.replace(/_/g, " ")}. ${regimeKnowledge.length} validated patterns are applicable.`,
      };

      if (avgWinRate > 0.5) {
        supportingData.push(dataPoint);
      } else {
        contradictingData.push(dataPoint);
      }
    }
  }

  // 4. Historical performance
  for (const [symbol, result] of Object.entries(query.historicalPerformance)) {
    if (result.totalTrades > 0) {
      const dataPoint: AIDataPoint = {
        label: `${symbol} historical performance`,
        value: `${result.totalTrades} trades, ${(result.winRate * 100).toFixed(0)}% win rate`,
        source: "historical_pattern",
        weight: 0.3,
        detail: `Over ${result.totalTrades} blind simulation trades, the system achieved a ${(result.winRate * 100).toFixed(0)}% win rate with Sharpe ${result.sharpeRatio.toFixed(2)}.`,
      };

      if (result.winRate > 0.5 && result.sharpeRatio > 0) {
        supportingData.push(dataPoint);
      } else {
        contradictingData.push(dataPoint);
      }
    }
  }

  // 5. Uncertainty factors
  if (allKnowledge.length < 5) {
    uncertainties.push("Limited historical knowledge available for this asset");
  }
  if (Object.keys(query.liveData).length === 0) {
    uncertainties.push("No live market data available at this time");
  }
  if (query.symbols.length > 1) {
    uncertainties.push("Multi-asset analysis adds complexity and uncertainty");
  }

  // Check for conflicting signals
  const supportStrength = supportingData.reduce((s, d) => s + d.weight, 0);
  const contradictStrength = contradictingData.reduce((s, d) => s + d.weight, 0);
  if (supportStrength > 0 && contradictStrength > 0) {
    const ratio = Math.min(supportStrength, contradictStrength) / Math.max(supportStrength, contradictStrength);
    if (ratio > 0.5) {
      uncertainties.push("Mixed signals from different intelligence sources");
    }
  }

  // 6. Generate recommendation
  const netStrength = supportStrength - contradictStrength;
  const totalStrength = supportStrength + contradictStrength;
  const confidence = totalStrength > 0
    ? Math.min(0.8, Math.abs(netStrength) / totalStrength * 0.7 + 0.1)
    : 0.3;

  let recommendation: AIResponse["recommendation"];
  let reasoning: string;
  let riskAssessment: string;
  let suggestedPositionSize: number | null = null;
  let levels: AIResponse["levels"] = null;

  if (netStrength > 0.3 && confidence > 0.5) {
    recommendation = "BUY";
    reasoning = buildReasoning("bullish", supportingData, contradictingData, query.symbols);
    riskAssessment = buildRiskAssessment("bullish", confidence, query.riskTolerance);

    // Position sizing based on confidence and risk tolerance
    const riskMultiplier = query.riskTolerance === "conservative" ? 0.5 :
      query.riskTolerance === "moderate" ? 1.0 : 1.5;
    suggestedPositionSize = Math.min(0.05, confidence * 0.03 * riskMultiplier);

    // Compute levels from live data
    for (const symbol of query.symbols) {
      const data = query.liveData[symbol];
      if (data) {
        const atr = data.price * 0.02; // Simplified ATR estimate
        levels = {
          entry: data.price,
          stopLoss: data.price - atr * 2,
          takeProfit: data.price + atr * 4,
        };
        break;
      }
    }
  } else if (netStrength < -0.3 && confidence > 0.5) {
    // For LONG-only system, recommend HOLD/WAIT when bearish
    recommendation = query.riskTolerance === "aggressive" ? "SELL" : "WAIT";
    reasoning = buildReasoning("bearish", supportingData, contradictingData, query.symbols);
    riskAssessment = buildRiskAssessment("bearish", confidence, query.riskTolerance);
  } else if (confidence < 0.3) {
    recommendation = "WAIT";
    reasoning = "Insufficient conviction from available intelligence sources. Recommend waiting for clearer signals.";
    riskAssessment = "Low confidence — risk of entering on noise is elevated.";
  } else {
    recommendation = "HOLD";
    reasoning = buildReasoning("neutral", supportingData, contradictingData, query.symbols);
    riskAssessment = "Mixed signals — maintain current position if any, or wait for clearer setup.";
  }

  return {
    recommendation,
    confidence,
    reasoning,
    supportingData: supportingData.sort((a, b) => b.weight - a.weight).slice(0, 5),
    contradictingData: contradictingData.sort((a, b) => b.weight - a.weight).slice(0, 5),
    uncertainties,
    riskAssessment,
    suggestedPositionSize,
    levels,
    knowledgeVersion: query.relevantKnowledge.length > 0 ? 1 : 0,
    generatedAt: Date.now(),
  };
}

// ── Helpers ───────────────────────────────────────────────

function buildReasoning(
  stance: "bullish" | "bearish" | "neutral",
  supporting: AIDataPoint[],
  contradicting: AIDataPoint[],
  symbols: string[],
): string {
  const parts: string[] = [];

  parts.push(`Analysis for ${symbols.join(", ")}:`);

  if (stance === "bullish") {
    parts.push(`The intelligence sources lean BULLISH with ${supporting.length} supporting factors.`);
    if (supporting.length > 0) {
      parts.push(`Key support: ${supporting[0].label} (${supporting[0].value}).`);
    }
  } else if (stance === "bearish") {
    parts.push(`The intelligence sources lean BEARISH with ${contradicting.length} risk factors.`);
    if (contradicting.length > 0) {
      parts.push(`Key risk: ${contradicting[0].label} (${contradicting[0].value}).`);
    }
  } else {
    parts.push("The intelligence sources show mixed or neutral signals.");
  }

  if (contradicting.length > 0 && stance === "bullish") {
    parts.push(`Caution: ${contradicting[0].label} presents a risk factor.`);
  }

  parts.push("This analysis combines live data, historical patterns, regime intelligence, and validated knowledge base entries.");

  return parts.join(" ");
}

function buildRiskAssessment(
  stance: "bullish" | "bearish" | "neutral",
  confidence: number,
  riskTolerance: string,
): string {
  const parts: string[] = [];

  if (confidence > 0.7) {
    parts.push("High-confidence setup with multiple confirming sources.");
  } else if (confidence > 0.5) {
    parts.push("Moderate-confidence setup. Some sources confirm, others are neutral.");
  } else {
    parts.push("Low-confidence setup. Proceed with caution.");
  }

  if (riskTolerance === "conservative") {
    parts.push("For conservative risk tolerance, consider reducing position size or waiting for higher confidence.");
  } else if (riskTolerance === "aggressive") {
    parts.push("Aggressive risk tolerance allows larger positions, but standard risk management still applies.");
  }

  parts.push("Always use stop losses. Never risk more than you can afford to lose.");

  return parts.join(" ");
}
