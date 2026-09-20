// ============================================================
// AI HYPOTHESIS LABORATORY — Validation Pipeline
//
// Validates hypotheses against strict criteria:
// - Statistical significance (minimum trades)
// - Out-of-sample performance vs training
// - Walk-forward consistency
// - Parameter stability (sensitivity)
// - Drawdown tolerance
// - Profit factor minimums
// - Degradation ratio (OOS/training)
//
// Rejects overfit, curve-fit, and unstable strategies.
// ============================================================

import type {
  Hypothesis,
  HypothesisTestResult,
  ValidationResult,
  ValidationCheck,
  ValidationVerdict,
} from "./types";

/** Validation thresholds — conservative defaults. */
export interface ValidationThresholds {
  minTrades: number;
  minTrainingSharpe: number;
  minOosSharpe: number;
  minWalkForwardSharpe: number;
  maxDegradationRatio: number;
  minWinRate: number;
  minProfitFactor: number;
  minExpectancy: number;
  maxDrawdown: number;
  minSensitivityStability: number; // fraction of parameters that must be stable
  minValidationSharpe: number;
  maxSharpeTrainValGap: number; // max allowed gap between train and val Sharpe
}

const DEFAULT_THRESHOLDS: ValidationThresholds = {
  minTrades: 30,
  minTrainingSharpe: 0.8,
  minOosSharpe: 0.5,
  minWalkForwardSharpe: 0.3,
  maxDegradationRatio: 0.6, // OOS should be at least 60% of training
  minWinRate: 0.35,
  minProfitFactor: 1.1,
  minExpectancy: 0.0005,
  maxDrawdown: 0.25,
  minSensitivityStability: 0.6, // 60% of parameters must be stable
  minValidationSharpe: 0.5,
  maxSharpeTrainValGap: 0.8, // validation Sharpe shouldn't be 80%+ lower than training
};

/**
 * Validate a complete test result for a hypothesis.
 * Returns a verdict and detailed check results.
 */
export function validateHypothesis(
  hypothesis: Hypothesis,
  testResult: HypothesisTestResult,
  thresholds?: Partial<ValidationThresholds>,
): ValidationResult {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const checks: ValidationCheck[] = [];
  const rejectionReasons: string[] = [];
  const recommendations: string[] = [];

  // ── Check 1: Sufficient trades ──
  const totalTrades = testResult.training.totalTrades + testResult.validation.totalTrades + testResult.outOfSample.totalTrades;
  checks.push(makeCheck(
    "sufficient_trades",
    "Minimum number of trades for statistical significance",
    totalTrades >= t.minTrades,
    totalTrades / t.minTrades,
    `${totalTrades} trades (minimum: ${t.minTrades})`,
    t.minTrades,
    totalTrades,
  ));
  if (totalTrades < t.minTrades) rejectionReasons.push(`Insufficient trades: ${totalTrades} < ${t.minTrades}`);

  // ── Check 2: Training Sharpe ──
  checks.push(makeCheck(
    "training_sharpe",
    "Training set Sharpe ratio",
    testResult.training.sharpeRatio >= t.minTrainingSharpe,
    Math.min(1, testResult.training.sharpeRatio / t.minTrainingSharpe),
    `Sharpe: ${testResult.training.sharpeRatio.toFixed(2)} (minimum: ${t.minTrainingSharpe})`,
    t.minTrainingSharpe,
    testResult.training.sharpeRatio,
  ));

  // ── Check 3: Validation Sharpe ──
  checks.push(makeCheck(
    "validation_sharpe",
    "Validation set Sharpe ratio",
    testResult.validation.sharpeRatio >= t.minValidationSharpe,
    Math.min(1, testResult.validation.sharpeRatio / t.minValidationSharpe),
    `Sharpe: ${testResult.validation.sharpeRatio.toFixed(2)} (minimum: ${t.minValidationSharpe})`,
    t.minValidationSharpe,
    testResult.validation.sharpeRatio,
  ));
  if (testResult.validation.sharpeRatio < t.minValidationSharpe) {
    rejectionReasons.push(`Validation Sharpe too low: ${testResult.validation.sharpeRatio.toFixed(2)}`);
  }

  // ── Check 4: Out-of-sample Sharpe ──
  checks.push(makeCheck(
    "oos_sharpe",
    "Out-of-sample Sharpe ratio",
    testResult.outOfSample.sharpeRatio >= t.minOosSharpe,
    Math.min(1, testResult.outOfSample.sharpeRatio / t.minOosSharpe),
    `Sharpe: ${testResult.outOfSample.sharpeRatio.toFixed(2)} (minimum: ${t.minOosSharpe})`,
    t.minOosSharpe,
    testResult.outOfSample.sharpeRatio,
  ));
  if (testResult.outOfSample.sharpeRatio < t.minOosSharpe) {
    rejectionReasons.push(`OOS Sharpe too low: ${testResult.outOfSample.sharpeRatio.toFixed(2)}`);
  }

  // ── Check 5: Walk-forward OOS Sharpe ──
  checks.push(makeCheck(
    "walk_forward_sharpe",
    "Walk-forward aggregate OOS Sharpe",
    testResult.walkForward.aggregateOOS.sharpe >= t.minWalkForwardSharpe,
    Math.min(1, testResult.walkForward.aggregateOOS.sharpe / Math.max(0.01, t.minWalkForwardSharpe)),
    `WF OOS Sharpe: ${testResult.walkForward.aggregateOOS.sharpe.toFixed(2)} (minimum: ${t.minWalkForwardSharpe})`,
    t.minWalkForwardSharpe,
    testResult.walkForward.aggregateOOS.sharpe,
  ));

  // ── Check 6: Degradation ratio ──
  checks.push(makeCheck(
    "degradation_ratio",
    "Walk-forward OOS/training degradation",
    testResult.walkForward.degradationRatio >= t.maxDegradationRatio,
    Math.min(1, testResult.walkForward.degradationRatio / t.maxDegradationRatio),
    `Ratio: ${(testResult.walkForward.degradationRatio * 100).toFixed(1)}% (minimum: ${(t.maxDegradationRatio * 100).toFixed(1)}%)`,
    t.maxDegradationRatio,
    testResult.walkForward.degradationRatio,
  ));
  if (testResult.walkForward.degradationRatio < t.maxDegradationRatio) {
    rejectionReasons.push(`Excessive degradation: OOS is only ${(testResult.walkForward.degradationRatio * 100).toFixed(1)}% of training`);
    recommendations.push("Strategy may be overfit. Consider reducing parameter complexity.");
  }

  // ── Check 7: Win rate ──
  checks.push(makeCheck(
    "win_rate",
    "Minimum win rate",
    testResult.outOfSample.winRate >= t.minWinRate,
    Math.min(1, testResult.outOfSample.winRate / t.minWinRate),
    `Win rate: ${(testResult.outOfSample.winRate * 100).toFixed(1)}% (minimum: ${(t.minWinRate * 100).toFixed(1)}%)`,
    t.minWinRate,
    testResult.outOfSample.winRate,
  ));

  // ── Check 8: Profit factor ──
  checks.push(makeCheck(
    "profit_factor",
    "Minimum profit factor",
    testResult.outOfSample.profitFactor >= t.minProfitFactor,
    Math.min(1, testResult.outOfSample.profitFactor / t.minProfitFactor),
    `PF: ${testResult.outOfSample.profitFactor.toFixed(2)} (minimum: ${t.minProfitFactor})`,
    t.minProfitFactor,
    testResult.outOfSample.profitFactor,
  ));

  // ── Check 9: Expectancy ──
  checks.push(makeCheck(
    "expectancy",
    "Positive expectancy after costs",
    testResult.outOfSample.expectancy >= t.minExpectancy,
    Math.min(1, testResult.outOfSample.expectancy / Math.max(0.0001, t.minExpectancy)),
    `Expectancy: ${(testResult.outOfSample.expectancy * 100).toFixed(3)}% (minimum: ${(t.minExpectancy * 100).toFixed(3)}%)`,
    t.minExpectancy,
    testResult.outOfSample.expectancy,
  ));
  if (testResult.outOfSample.expectancy < 0) {
    rejectionReasons.push(`Negative expectancy: ${(testResult.outOfSample.expectancy * 100).toFixed(3)}%`);
  }

  // ── Check 10: Maximum drawdown ──
  checks.push(makeCheck(
    "max_drawdown",
    "Maximum drawdown within tolerance",
    testResult.outOfSample.maxDrawdown <= t.maxDrawdown,
    1 - (testResult.outOfSample.maxDrawdown / t.maxDrawdown),
    `Max DD: ${(testResult.outOfSample.maxDrawdown * 100).toFixed(1)}% (maximum: ${(t.maxDrawdown * 100).toFixed(1)}%)`,
    t.maxDrawdown,
    testResult.outOfSample.maxDrawdown,
  ));
  if (testResult.outOfSample.maxDrawdown > t.maxDrawdown) {
    rejectionReasons.push(`Drawdown too high: ${(testResult.outOfSample.maxDrawdown * 100).toFixed(1)}%`);
  }

  // ── Check 11: Train/Val consistency ──
  const trainValGap = testResult.training.sharpeRatio - testResult.validation.sharpeRatio;
  const trainValGapRatio = testResult.training.sharpeRatio > 0 ? trainValGap / testResult.training.sharpeRatio : 0;
  checks.push(makeCheck(
    "train_val_consistency",
    "Training/validation consistency",
    trainValGapRatio <= t.maxSharpeTrainValGap,
    1 - Math.max(0, (trainValGapRatio - t.maxSharpeTrainValGap) / t.maxSharpeTrainValGap),
    `Gap: ${(trainValGapRatio * 100).toFixed(1)}% (maximum: ${(t.maxSharpeTrainValGap * 100).toFixed(1)}%)`,
    t.maxSharpeTrainValGap,
    trainValGapRatio,
  ));
  if (trainValGapRatio > t.maxSharpeTrainValGap) {
    rejectionReasons.push(`Train/Val overfit detected: ${(trainValGapRatio * 100).toFixed(1)}% gap`);
    recommendations.push("Large train/val gap suggests curve fitting. Simplify entry conditions.");
  }

  // ── Check 12: Parameter stability ──
  const stableParams = testResult.sensitivity.filter(s => s.isStable).length;
  const totalParams = testResult.sensitivity.length;
  const stabilityRatio = totalParams > 0 ? stableParams / totalParams : 0;
  checks.push(makeCheck(
    "parameter_stability",
    "Parameter sensitivity stability",
    stabilityRatio >= t.minSensitivityStability,
    stabilityRatio / t.minSensitivityStability,
    `${stableParams}/${totalParams} parameters stable (${(stabilityRatio * 100).toFixed(0)}%)`,
    t.minSensitivityStability,
    stabilityRatio,
  ));
  if (stabilityRatio < t.minSensitivityStability) {
    rejectionReasons.push(`Unstable parameters: only ${stableParams}/${totalParams} stable`);
    recommendations.push("Strategy is sensitive to parameter changes. Consider wider parameter ranges.");
  }

  // ── Check 13: Walk-forward window consistency ──
  const wfWindowsPositive = testResult.walkForward.windows.filter(w => w.outOfSample.expectancy > 0).length;
  const wfConsistency = testResult.walkForward.windowCount > 0
    ? wfWindowsPositive / testResult.walkForward.windowCount
    : 0;
  checks.push(makeCheck(
    "wf_window_consistency",
    "Walk-forward window consistency",
    wfConsistency >= 0.5,
    wfConsistency / 0.5,
    `${wfWindowsPositive}/${testResult.walkForward.windowCount} windows profitable`,
    0.5,
    wfConsistency,
  ));
  if (wfConsistency < 0.5) {
    rejectionReasons.push(`Walk-forward inconsistency: only ${wfWindowsPositive}/${testResult.walkForward.windowCount} windows profitable`);
  }

  // ── Verdict ──
  const failedCritical = checks.filter(c => !c.passed).length;
  const overallScore = checks.reduce((s, c) => s + c.score, 0) / checks.length;

  let verdict: ValidationVerdict;
  if (failedCritical === 0 && overallScore >= 0.7) {
    verdict = "passed";
  } else if (failedCritical <= 2 && overallScore >= 0.5) {
    verdict = "conditional";
    recommendations.push("Hypothesis is borderline. Consider tightening conditions or adding filters.");
  } else {
    verdict = "failed";
  }

  // Add general recommendations
  if (verdict === "passed") {
    recommendations.push("Hypothesis is validated. Consider promoting to strategy system after monitoring.");
  }

  return {
    hypothesisId: hypothesis.id,
    verdict,
    checks,
    overallScore,
    rejectionReasons,
    recommendations,
    validatedAt: Date.now(),
  };
}

function makeCheck(
  name: string,
  description: string,
  passed: boolean,
  score: number,
  details: string,
  threshold: number,
  actual: number,
): ValidationCheck {
  return {
    name,
    description,
    passed,
    score: Math.max(0, Math.min(1, score)),
    details,
    threshold,
    actual,
  };
}
