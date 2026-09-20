// ============================================================
// AI HYPOTHESIS LABORATORY — Core Types
//
// Every hypothesis is a measurable, testable claim about market
// behavior. The lab automatically generates, backtests, and
// validates hypotheses before any can enter the trading system.
//
// NEVER deploys directly to trading.
// ============================================================

import type { Interval } from "@/lib/market/types";
import type { TradeSide, MarketRegime } from "@/lib/arena/types";

// ── Hypothesis ──────────────────────────────────────────────

export type HypothesisStatus =
  | "draft"        // just created
  | "testing"      // backtest in progress
  | "validated"    // passed all validation gates
  | "rejected"     // failed validation
  | "promoted";    // approved for strategy system

export type HypothesisCategory =
  | "trend_breakout"
  | "mean_reversion"
  | "momentum"
  | "volatility_regime"
  | "volume_profile"
  | "cross_timeframe"
  | "pattern_recognition"
  | "custom";

/** A single measurable trading hypothesis. */
export interface Hypothesis {
  id: string;
  /** Human-readable name. */
  name: string;
  /** What this hypothesis claims. */
  description: string;
  category: HypothesisCategory;
  /** Target market/pair. */
  symbol: string;
  /** Primary execution timeframe. */
  timeframe: Interval;
  /** Higher timeframe for context (optional). */
  higherTimeframe: Interval | null;
  /** Trade direction. */
  side: TradeSide;
  /** Parameterized conditions that define entries. */
  conditions: HypothesisCondition[];
  /** Entry logic rules. */
  entryLogic: EntryLogic;
  /** Exit logic rules. */
  exitLogic: ExitLogic;
  /** Risk assumptions for position sizing. */
  riskAssumptions: RiskAssumptions;
  /** Expected edge and performance targets. */
  expectedEdge: ExpectedEdge;
  /** Current status. */
  status: HypothesisStatus;
  /** When the hypothesis was created. */
  createdAt: number;
  /** When the hypothesis was last tested. */
  lastTestedAt: number | null;
  /** Version (incremented on parameter changes). */
  version: number;
  /** Tags for filtering and organization. */
  tags: string[];
}

/** A parameterized condition that can be tested. */
export interface HypothesisCondition {
  /** Indicator or metric name (e.g. "rsi14", "ema_alignment", "volume_ratio"). */
  indicator: string;
  /** Comparison operator. */
  operator: "gt" | "lt" | "gte" | "lte" | "eq" | "between" | "crosses_above" | "crosses_below";
  /** Threshold value(s). */
  value: number;
  /** For "between" operator: upper bound. */
  valueUpper?: number;
  /** Whether this condition is required (hard gate) or optional (soft filter). */
  required: boolean;
  /** Weight in scoring (0-1, used for optional conditions). */
  weight?: number;
}

/** Entry logic specification. */
export interface EntryLogic {
  /** All conditions that must be true for entry. */
  conditions: HypothesisCondition[];
  /** Minimum number of optional conditions that must pass. */
  minOptionalConditions: number;
  /** Confirmation candles required after conditions are met. */
  confirmationBars: number;
  /** Maximum bars to wait for entry after conditions first met. */
  maxEntryDelay: number;
}

/** Exit logic specification. */
export interface ExitLogic {
  /** Stop loss: ATR multiplier or fixed percentage. */
  stopLoss: { type: "atr" | "percent" | "fixed"; value: number };
  /** Take profit: ATR multiplier, fixed percentage, or risk:reward ratio. */
  takeProfit: { type: "atr" | "percent" | "rr_ratio" | "fixed"; value: number };
  /** Trailing stop configuration. */
  trailingStop: { enabled: boolean; activationRR: number; trailPercent: number } | null;
  /** Maximum holding period in candles. */
  maxHoldBars: number;
  /** Time-based exit (e.g. close before weekend). */
  timeExit: { enabled: boolean; hour?: number; dayOfWeek?: number } | null;
}

/** Risk assumptions for the hypothesis. */
export interface RiskAssumptions {
  /** Risk per trade as fraction of equity (e.g. 0.005 = 0.5%). */
  riskPerTrade: number;
  /** Maximum simultaneous positions for this hypothesis. */
  maxPositions: number;
  /** Expected entry slippage in bps. */
  slippageBps: number;
  /** Trading fees in bps (both sides combined). */
  feesBps: number;
  /** Maximum drawdown before hypothesis is paused. */
  maxDrawdownPercent: number;
}

/** Expected edge targets. */
export interface ExpectedEdge {
  /** Minimum acceptable Sharpe ratio. */
  minSharpe: number;
  /** Minimum acceptable win rate. */
  minWinRate: number;
  /** Minimum acceptable profit factor. */
  minProfitFactor: number;
  /** Minimum expected value per trade (after costs). */
  minExpectancy: number;
  /** Minimum number of trades for statistical significance. */
  minTrades: number;
}

// ── Test Results ────────────────────────────────────────────

export type TestDataSplit = "training" | "validation" | "out_of_sample";

/** Results from a single backtest run on a data split. */
export interface BacktestResult {
  split: TestDataSplit;
  /** Period tested. */
  startTime: number;
  endTime: number;
  /** Number of candles in the test. */
  candleCount: number;
  /** Number of trades generated. */
  totalTrades: number;
  /** Winning trades. */
  winningTrades: number;
  /** Losing trades. */
  losingTrades: number;
  /** Win rate (0-1). */
  winRate: number;
  /** Total return (fraction). */
  totalReturn: number;
  /** Annualized return. */
  annualizedReturn: number;
  /** Sharpe ratio. */
  sharpeRatio: number;
  /** Sortino ratio. */
  sortinoRatio: number;
  /** Profit factor. */
  profitFactor: number;
  /** Expectancy per trade (fraction). */
  expectancy: number;
  /** Maximum drawdown (fraction). */
  maxDrawdown: number;
  /** Average win (fraction). */
  avgWin: number;
  /** Average loss (fraction). */
  avgLoss: number;
  /** Best trade. */
  bestTrade: number;
  /** Worst trade. */
  worstTrade: number;
  /** Average holding period in candles. */
  avgHoldingBars: number;
  /** Total fees paid. */
  totalFees: number;
  /** Total slippage cost. */
  totalSlippage: number;
  /** Equity curve (sampled at trade boundaries). */
  equityCurve: number[];
  /** Monthly returns for regime analysis. */
  monthlyReturns: { month: string; return: number; regime: MarketRegime }[];
  /** Individual trade details. */
  trades: BacktestTrade[];
}

/** A single trade from a backtest. */
export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  side: TradeSide;
  pnl: number;
  pnlPercent: number;
  fees: number;
  slippage: number;
  holdingBars: number;
  exitReason: "take_profit" | "stop_loss" | "trailing_stop" | "time_exit" | "max_hold";
  regime: MarketRegime;
}

/** Walk-forward test result. */
export interface WalkForwardResult {
  /** Number of walk-forward windows tested. */
  windowCount: number;
  /** Results for each window. */
  windows: WalkForwardWindow[];
  /** Aggregate OOS performance across all windows. */
  aggregateOOS: {
    sharpe: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdown: number;
    totalTrades: number;
  };
  /** Degradation ratio: OOS performance / training performance. */
  degradationRatio: number;
}

/** A single walk-forward window. */
export interface WalkForwardWindow {
  windowIndex: number;
  trainingStart: number;
  trainingEnd: number;
  oosStart: number;
  oosEnd: number;
  training: BacktestResult;
  outOfSample: BacktestResult;
}

/** Sensitivity test result. */
export interface SensitivityResult {
  parameter: string;
  baseValue: number;
  testedValues: number[];
  results: {
    value: number;
    sharpe: number;
    winRate: number;
    expectancy: number;
    maxDrawdown: number;
  }[];
  /** Whether performance is stable across parameter range. */
  isStable: boolean;
  /** Maximum performance drop from parameter variation. */
  maxPerformanceDrop: number;
}

// ── Validation ──────────────────────────────────────────────

export type ValidationVerdict = "passed" | "failed" | "conditional";

/** A single validation check result. */
export interface ValidationCheck {
  name: string;
  description: string;
  passed: boolean;
  /** Check result as a score (0-1). */
  score: number;
  details: string;
  /** Threshold used for this check. */
  threshold: number;
  /** Actual measured value. */
  actual: number;
}

/** Complete validation result for a hypothesis. */
export interface ValidationResult {
  hypothesisId: string;
  verdict: ValidationVerdict;
  /** All individual checks. */
  checks: ValidationCheck[];
  /** Overall validation score (0-1). */
  overallScore: number;
  /** Rejection reasons (if rejected). */
  rejectionReasons: string[];
  /** Recommendations for improvement. */
  recommendations: string[];
  /** Timestamp. */
  validatedAt: number;
}

// ── Composite Results ───────────────────────────────────────

/** Complete test results for a hypothesis. */
export interface HypothesisTestResult {
  hypothesisId: string;
  hypothesisVersion: number;
  /** Training set results. */
  training: BacktestResult;
  /** Validation set results. */
  validation: BacktestResult;
  /** Out-of-sample results. */
  outOfSample: BacktestResult;
  /** Walk-forward results. */
  walkForward: WalkForwardResult;
  /** Sensitivity analysis results. */
  sensitivity: SensitivityResult[];
  /** Validation verdict. */
  validationResult: ValidationResult;
  /** When the test was completed. */
  completedAt: number;
  /** Total computation time in ms. */
  computationTimeMs: number;
}

// ── Strategy Promotion ──────────────────────────────────────

/** Configuration for promoting a validated hypothesis to the arena strategy system. */
export interface StrategyPromotion {
  hypothesisId: string;
  hypothesisVersion: number;
  /** Strategy identifier for the arena engine. */
  strategyId: string;
  /** Parameters to pass to the arena engine. */
  parameters: Record<string, number>;
  /** When the promotion was created. */
  promotedAt: number;
  /** Whether the promotion is currently active. */
  active: boolean;
}

// ── Lab Configuration ───────────────────────────────────────

export interface LabConfig {
  /** Default fees in bps. */
  defaultFeesBps: number;
  /** Default slippage in bps. */
  defaultSlippageBps: number;
  /** Minimum candles required for testing. */
  minCandlesRequired: number;
  /** Training data fraction (e.g. 0.6 = 60%). */
  trainingFraction: number;
  /** Validation data fraction. */
  validationFraction: number;
  /** Out-of-sample fraction. */
  outOfSampleFraction: number;
  /** Walk-forward window size in candles. */
  walkForwardWindowCandles: number;
  /** Walk-forward step size in candles. */
  walkForwardStepCandles: number;
  /** Number of sensitivity test variations per parameter. */
  sensitivityVariations: number;
  /** Minimum walk-forward OOS degradation ratio to pass. */
  minWalkForwardDegradation: number;
  /** Maximum hypothesis age (ms) before re-testing. */
  maxHypothesisAgeMs: number;
}
