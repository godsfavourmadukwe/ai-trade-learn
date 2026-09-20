// ============================================================
// AI TRADE ARENA — Decision Fusion Engine
//
// Combines outputs from all analysis modules into a single
// trading decision. Implements weighted voting, veto logic,
// consensus thresholds, and confidence calibration.
//
// Default decision: NO_TRADE
// A trade is only produced when ALL critical gates pass.
// ============================================================

import { ALL_MODULES, type AnalysisModule, type ModuleInput, type ModuleOutput, type FusionResult, type EvidenceItem } from "./modules";
import type { TradeSide } from "./types";
import type { MarketRegime, ArenaSignalEvidence } from "./types";

// ── Configuration ──────────────────────────────────────────

export interface FusionConfig {
  /** Minimum fraction of directional modules that must agree (0-1). */
  minConsensusRatio: number;
  /** Minimum weighted confidence to produce a signal. */
  minConfidence: number;
  /** Maximum allowed model uncertainty. */
  maxUncertainty: number;
  /** Number of supporting modules required minimum. */
  minSupportingModules: number;
  /** Maximum allowed contradicting modules. */
  maxContradictingModules: number;
  /** Whether a single module veto kills the trade. */
  vetoPower: boolean;
  /** Fees in bps for expected value calculation. */
  feesBps: number;
  /** Slippage in bps. */
  slippageBps: number;
}

const DEFAULT_FUSION_CONFIG: FusionConfig = {
  minConsensusRatio: 0.6,
  minConfidence: 0.55,
  maxUncertainty: 0.35,
  minSupportingModules: 4,
  maxContradictingModules: 2,
  vetoPower: true,
  feesBps: 10,
  slippageBps: 5,
};

// ── Fusion Engine ──────────────────────────────────────────

export class DecisionFusionEngine {
  private config: FusionConfig;
  private modules: AnalysisModule[];

  constructor(config?: Partial<FusionConfig>) {
    this.config = { ...DEFAULT_FUSION_CONFIG, ...config };
    this.modules = [...ALL_MODULES];
  }

  updateConfig(partial: Partial<FusionConfig>): void {
    Object.assign(this.config, partial);
  }

  /**
   * Run all analysis modules and fuse their outputs into a single decision.
   * Returns the full fusion result with evidence trail.
   */
  evaluate(input: ModuleInput): FusionResult {
    // ── 1. Run all modules ──
    const moduleOutputs: ModuleOutput[] = [];
    for (const mod of this.modules) {
      try {
        const output = mod.analyze(input);
        moduleOutputs.push(output);
      } catch (err) {
        // Module failure — record it and continue
        moduleOutputs.push({
          module: mod.name,
          description: `Module failed: ${err instanceof Error ? err.message : "unknown error"}`,
          direction: "neutral",
          strength: 0,
          confidence: 0,
          uncertainty: 1,
          evidence: [{
            type: "neutral",
            label: "Module Error",
            value: "N/A",
            detail: `Module "${mod.name}" threw an error during analysis.`,
          }],
          veto: false,
          metrics: {},
          analyzedAt: input.now,
        });
      }
    }

    // ── 2. Check for vetoes ──
    const vetoModules: string[] = [];
    for (const output of moduleOutputs) {
      if (output.veto) {
        vetoModules.push(output.module);
      }
    }

    // ── 3. Classify module directions ──
    const supportingModules: string[] = [];
    const contradictingModules: string[] = [];
    const neutralModules: string[] = [];

    for (const output of moduleOutputs) {
      if (output.direction === "neutral" || output.confidence < 0.2) {
        neutralModules.push(output.module);
      } else {
        const aligned = output.direction === (input.side === "long" ? "bullish" : "bearish");
        if (aligned) {
          supportingModules.push(output.module);
        } else {
          contradictingModules.push(output.module);
        }
      }
    }

    const directionalModuleCount = supportingModules.length + contradictingModules.length;
    const consensusRatio = directionalModuleCount > 0
      ? supportingModules.length / directionalModuleCount
      : 0;

    // ── 4. Compute weighted confidence ──
    let weightedConfidenceSum = 0;
    let weightSum = 0;
    let weightedUncertaintySum = 0;

    for (const output of moduleOutputs) {
      const mod = this.modules.find(m => m.name === output.module);
      const weight = mod?.weight ?? 0.1;
      weightedConfidenceSum += output.confidence * weight;
      weightedUncertaintySum += output.uncertainty * weight;
      weightSum += weight;
    }

    const avgConfidence = weightSum > 0 ? weightedConfidenceSum / weightSum : 0;
    const avgUncertainty = weightSum > 0 ? weightedUncertaintySum / weightSum : 1;

    // ── 5. ML Predictor specific metrics ──
    const mlOutput = moduleOutputs.find(m => m.module === "ml_predictor");
    const modelProbability = mlOutput?.metrics.modelProbability ?? 0.5;
    const expectedValue = mlOutput?.metrics.expectedValue ?? 0;
    const modelUncertainty = mlOutput?.metrics.modelUncertainty ?? 0.5;

    // ── 6. Aggregate evidence ──
    const allEvidence: EvidenceItem[] = [];
    for (const output of moduleOutputs) {
      for (const ev of output.evidence) {
        allEvidence.push({ ...ev, weight: ev.weight ?? 1 });
      }
    }

    // Sort: supporting first, then neutral, then contradicting
    allEvidence.sort((a, b) => {
      const order = { supporting: 0, neutral: 1, contradicting: 2 };
      return (order[a.type] ?? 1) - (order[b.type] ?? 1);
    });

    // ── 7. Decision logic ──
    let decision: FusionResult["decision"] = "NO_TRADE";
    const reasonCodes: string[] = [];

    // Gate 1: Veto check
    if (this.config.vetoPower && vetoModules.length > 0) {
      reasonCodes.push("module_veto");
    }
    // Gate 2: Consensus ratio
    else if (consensusRatio < this.config.minConsensusRatio) {
      reasonCodes.push("insufficient_consensus");
    }
    // Gate 3: Minimum supporting modules
    else if (supportingModules.length < this.config.minSupportingModules) {
      reasonCodes.push("too_few_supporting_modules");
    }
    // Gate 4: Maximum contradicting modules
    else if (contradictingModules.length > this.config.maxContradictingModules) {
      reasonCodes.push("too_many_contradictions");
    }
    // Gate 5: Confidence threshold
    else if (avgConfidence < this.config.minConfidence) {
      reasonCodes.push("low_confidence");
    }
    // Gate 6: Uncertainty threshold
    else if (avgUncertainty > this.config.maxUncertainty) {
      reasonCodes.push("high_uncertainty");
    }
    // Gate 7: Positive expected value
    else if (expectedValue <= 0) {
      reasonCodes.push("negative_expected_value");
    }
    // Gate 8: Model probability minimum
    else if (modelProbability < 0.5) {
      reasonCodes.push("model_probability_below_50");
    }
    // All gates passed → produce signal
    else {
      decision = input.side === "long" ? "BUY" : "SELL";
      reasonCodes.push("all_gates_passed");
    }

    // ── 8. Build summary ──
    const summary = this.buildSummary(
      decision,
      input.symbol,
      input.side,
      consensusRatio,
      supportingModules,
      contradictingModules,
      vetoModules,
      modelProbability,
      expectedValue,
      avgConfidence,
      avgUncertainty,
      reasonCodes,
    );

    return {
      decision,
      confidence: avgConfidence,
      uncertainty: avgUncertainty,
      modules: moduleOutputs,
      supportingCount: supportingModules.length,
      contradictingCount: contradictingModules.length,
      neutralCount: neutralModules.length,
      vetoModules,
      evidence: allEvidence,
      reasonCodes,
      summary,
      generatedAt: input.now,
      modelProbability,
      expectedValue,
      modelUncertainty,
    };
  }

  private buildSummary(
    decision: FusionResult["decision"],
    symbol: string,
    side: TradeSide,
    consensus: number,
    supporting: string[],
    contradicting: string[],
    vetoed: string[],
    prob: number,
    ev: number,
    confidence: number,
    uncertainty: number,
    reasonCodes: string[],
  ): string {
    if (decision === "NO_TRADE") {
      const vetoStr = vetoed.length > 0 ? ` VETOED by: ${vetoed.join(", ")}.` : "";
      const contraStr = contradicting.length > 0 ? ` Contradicted by: ${contradicting.join(", ")}.` : "";
      return `NO TRADE on ${symbol} ${side.toUpperCase()}.${vetoStr}${contraStr} Consensus: ${(consensus * 100).toFixed(0)}%. Confidence: ${(confidence * 100).toFixed(0)}%. Reason: ${reasonCodes.join(", ")}.`;
    }
    return `${decision} ${symbol} ${side.toUpperCase()}: ${(consensus * 100).toFixed(0)}% consensus across ${supporting.length} modules. Model prob: ${(prob * 100).toFixed(1)}%. EV: ${(ev * 100).toFixed(3)}%. Confidence: ${(confidence * 100).toFixed(0)}%. Modules supporting: ${supporting.join(", ")}.`;
  }

  /**
   * Convert fusion result to ArenaSignalEvidence for compatibility
   * with the existing arena signal format.
   */
  toSignalEvidence(result: FusionResult): ArenaSignalEvidence {
    const getEvidence = (module: string, fallback: string): ArenaSignalEvidence["trend"] => {
      const mod = result.modules.find(m => m.module === module);
      const ev = mod?.evidence[0];
      return ev
        ? { label: ev.label, value: ev.value, detail: ev.detail, source: module }
        : { label: module, value: "N/A", detail: fallback, source: module };
    };

    return {
      trend: getEvidence("technical", "No technical evidence"),
      momentum: getEvidence("momentum", "No momentum evidence"),
      volatility: getEvidence("volatility", "No volatility evidence"),
      volume: getEvidence("volume", "No volume evidence"),
      liquidity: getEvidence("volume", "No liquidity data"),
      regime: getEvidence("regime", "No regime data"),
      model: getEvidence("ml_predictor", "No model prediction"),
      expectedValue: {
        label: "Expected Value",
        value: `${(result.expectedValue * 100).toFixed(3)}%`,
        detail: `After fees. Model confidence: ${(result.confidence * 100).toFixed(0)}%.`,
        source: "fusion_engine",
      },
      riskReward: getEvidence("ml_predictor", "No R:R data"),
      uncertainty: {
        label: "Ensemble Uncertainty",
        value: `${(result.uncertainty * 100).toFixed(1)}%`,
        detail: `Module agreement: ${result.supportingCount} supporting, ${result.contradictingCount} contradicting, ${result.neutralCount} neutral.`,
        source: "fusion_engine",
      },
    };
  }

  /** Get the registered modules list. */
  getModules(): AnalysisModule[] {
    return [...this.modules];
  }
}

// ── Module-level singleton ──
export const decisionFusionEngine = new DecisionFusionEngine();
