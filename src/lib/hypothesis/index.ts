// ============================================================
// AI HYPOTHESIS LABORATORY — Main Exports
//
// Provides the complete hypothesis lifecycle:
//   Generate → Test → Validate → Promote (never auto-deploy)
// ============================================================

// Types
export type {
  Hypothesis,
  HypothesisCondition,
  HypothesisCategory,
  HypothesisStatus,
  EntryLogic,
  ExitLogic,
  RiskAssumptions,
  ExpectedEdge,
  BacktestResult,
  BacktestTrade,
  TestDataSplit,
  WalkForwardResult,
  WalkForwardWindow,
  SensitivityResult,
  HypothesisTestResult,
  ValidationResult,
  ValidationCheck,
  ValidationVerdict,
  StrategyPromotion,
  LabConfig,
} from "./types";

// Generator
export { generateHypotheses, generateBatch } from "./generator";
export type { GeneratorConfig } from "./generator";

// Tester
export { testHypothesis, runBacktest, runWalkForward, runSensitivityTests } from "./tester";

// Validation
export { validateHypothesis } from "./validation";
export type { ValidationThresholds } from "./validation";

// Registry
export { HypothesisRegistry, hypothesisRegistry } from "./registry";

// ── High-Level Orchestrator ─────────────────────────────────

import type { Candle } from "@/lib/market/types";
import type { Hypothesis, HypothesisTestResult } from "./types";
import { generateHypotheses } from "./generator";
import { testHypothesis } from "./tester";
import { validateHypothesis } from "./validation";
import { hypothesisRegistry } from "./registry";

export interface LabRunConfig {
  /** Symbols to generate hypotheses for. */
  symbols: string[];
  /** Candle data per symbol. */
  candleData: Map<string, Candle[]>;
  /** Custom validation thresholds. */
  validationThresholds?: Partial<import("./validation").ValidationThresholds>;
  /** Custom backtest configuration. */
  backtestConfig?: {
    trainingFraction?: number;
    validationFraction?: number;
    outOfSampleFraction?: number;
    walkForwardWindowCandles?: number;
    walkForwardStepCandles?: number;
  };
}

export interface LabRunResult {
  hypothesesGenerated: number;
  hypothesesTested: number;
  hypothesesValidated: number;
  hypothesesRejected: number;
  validatedHypotheses: Hypothesis[];
  testResults: HypothesisTestResult[];
}

/**
 * Run the complete lab pipeline for a set of symbols.
 * Generates hypotheses, tests them, validates, and stores results.
 * Returns validated candidates for manual review.
 */
export function runLabPipeline(config: LabRunConfig): LabRunResult {
  const { symbols, candleData, validationThresholds, backtestConfig } = config;

  let totalGenerated = 0;
  let totalTested = 0;
  let totalValidated = 0;
  let totalRejected = 0;
  const validatedHypotheses: Hypothesis[] = [];
  const testResults: HypothesisTestResult[] = [];

  // ── Phase 1: Generate ──
  for (const symbol of symbols) {
    const candles = candleData.get(symbol);
    if (!candles || candles.length < 100) continue;

    const hypotheses = generateHypotheses(symbol, candles);
    for (const h of hypotheses) {
      hypothesisRegistry.add(h);
      totalGenerated++;
    }
  }

  // ── Phase 2: Test & Validate ──
  const allHypotheses = hypothesisRegistry.listByStatus("draft");
  for (const hypothesis of allHypotheses) {
    const candles = candleData.get(hypothesis.symbol);
    if (!candles || candles.length < 100) continue;

    hypothesisRegistry.updateStatus(hypothesis.id, "testing");

    // Test
    const result = testHypothesis(candles, hypothesis, backtestConfig);

    // Validate
    const validation = validateHypothesis(hypothesis, result, validationThresholds);
    result.validationResult = validation;

    // Store
    hypothesisRegistry.storeTestResult(result);
    testResults.push(result);
    totalTested++;

    if (validation.verdict === "passed") {
      totalValidated++;
      validatedHypotheses.push(hypothesis);
    } else {
      totalRejected++;
    }
  }

  return {
    hypothesesGenerated: totalGenerated,
    hypothesesTested: totalTested,
    hypothesesValidated: totalValidated,
    hypothesesRejected: totalRejected,
    validatedHypotheses,
    testResults,
  };
}
