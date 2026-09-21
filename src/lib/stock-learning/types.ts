// ============================================================
// AUTONOMOUS STOCK MARKET LEARNING — Core Types
//
// Types for the blind simulation, knowledge base, continuous
// learning pipeline, and conversational AI integration.
//
// Knowledge flows forward only:
//   Market Data → Training → Blind Agents → Evaluation →
//   Validation → Knowledge Base → Conversational AI
//
// NEVER allows backward contamination from AI to historical tests.
// ============================================================

import type { Interval, Candle } from "@/lib/market/types";
import type { TradeSide, MarketRegime } from "@/lib/arena/types";

// ── Stock Universe ────────────────────────────────────────

export type AssetClass = "stock" | "etf" | "crypto";
export type Market = "NYSE" | "NASDAQ" | "AMEX" | "BINANCE" | "OTHER";

export interface StockInfo {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  market: Market;
  sector: string;
  industry: string;
  marketCap: number;
  avgVolume: number;
  /** Supported intervals for this asset. */
  supportedIntervals: Interval[];
  /** Whether the asset is currently tradeable. */
  tradeable: boolean;
  /** Currency denomination. */
  currency: string;
  /** Last known price (0 if unknown). */
  lastPrice: number;
}

export interface UniverseSnapshot {
  assets: StockInfo[];
  totalCount: number;
  lastRefreshed: number;
  source: string;
}

// ── Training Episode ──────────────────────────────────────

export type EpisodeStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TrainingEpisode {
  /** Unique episode ID. */
  id: string;
  /** Stock/asset being traded. */
  symbol: string;
  /** Timeframe for the training. */
  interval: Interval;
  /** Historical period tested. */
  startTime: number;
  endTime: number;
  /** The training agent ID (for isolation tracking). */
  agentId: string;
  /** Knowledge version snapshot used for this episode. */
  knowledgeVersion: string;
  /** Status of this episode. */
  status: EpisodeStatus;
  /** Final result (null if not completed). */
  result: EpisodeResult | null;
  /** When the episode was created. */
  createdAt: number;
  /** When the episode started running. */
  startedAt: number | null;
  /** When the episode completed. */
  completedAt: number | null;
  /** Error message if failed. */
  error: string | null;
  /** Checkpoint data for resumability. */
  checkpoint: EpisodeCheckpoint | null;
}

/** Blind trader's decision at a single point in time. */
export interface BlindDecision {
  /** Timestamp of the decision. */
  timestamp: number;
  /** Price at decision time. */
  price: number;
  /** Candles visible to the agent at decision time (NO future data). */
  visibleCandles: Candle[];
  /** Decision made by the agent. */
  action: "BUY" | "SELL" | "HOLD";
  /** Entry price (if BUY/SELL). */
  entryPrice: number | null;
  /** Stop loss level. */
  stopLoss: number | null;
  /** Take profit level. */
  takeProfit: number | null;
  /** Position size as fraction of equity. */
  positionSize: number | null;
  /** Agent's reasoning (stored for audit, NOT used for future decisions). */
  reasoning: string;
  /** Agent's confidence in the decision (0-1). */
  confidence: number;
  /** Agent's estimated probability of success. */
  estimatedProbability: number;
  /** Key indicators/features at decision time. */
  features: Record<string, number>;
}

/** Result of a completed training episode. */
export interface EpisodeResult {
  /** Total trades executed. */
  totalTrades: number;
  /** Winning trades. */
  winningTrades: number;
  /** Losing trades. */
  losingTrades: number;
  /** Win rate (0-1). */
  winRate: number;
  /** Total return (fraction). */
  totalReturn: number;
  /** Sharpe-like ratio. */
  sharpeRatio: number;
  /** Sortino ratio. */
  sortinoRatio: number;
  /** Profit factor. */
  profitFactor: number;
  /** Expectancy per trade. */
  expectancy: number;
  /** Maximum drawdown. */
  maxDrawdown: number;
  /** Maximum consecutive losses. */
  maxConsecutiveLosses: number;
  /** Average win size. */
  avgWin: number;
  /** Average loss size. */
  avgLoss: number;
  /** Risk/reward ratio achieved. */
  avgRiskReward: number;
  /** Total fees paid. */
  totalFees: number;
  /** Individual trade results. */
  trades: EpisodeTrade[];
  /** Equity curve (sampled at trade boundaries). */
  equityCurve: number[];
  /** All decisions made during the episode. */
  decisions: BlindDecision[];
  /** Market regime breakdown. */
  regimePerformance: Record<MarketRegime, { trades: number; pnl: number; winRate: number }>;
}

/** A single trade from a training episode. */
export interface EpisodeTrade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  side: TradeSide;
  pnl: number;
  pnlPercent: number;
  fees: number;
  holdingBars: number;
  exitReason: "take_profit" | "stop_loss" | "trailing_stop" | "time_exit" | "signal_exit";
  regime: MarketRegime;
  /** The blind decision that triggered this trade. */
  decisionIndex: number;
}

/** Checkpoint for resumable episodes. */
export interface EpisodeCheckpoint {
  /** Index of the last processed candle. */
  lastCandleIndex: number;
  /** Current equity. */
  currentEquity: number;
  /** Open position (if any). */
  openPosition: {
    side: TradeSide;
    entryPrice: number;
    entryTime: number;
    stopLoss: number;
    takeProfit: number;
    positionSize: number;
  } | null;
  /** Decisions made so far. */
  decisionsSoFar: BlindDecision[];
  /** Trades completed so far. */
  tradesSoFar: EpisodeTrade[];
  /** Checkpoint timestamp. */
  checkpointedAt: number;
}

// ── Stock Knowledge Base ──────────────────────────────────

export type KnowledgeType =
  | "pattern"
  | "strategy"
  | "regime_behavior"
  | "correlation"
  | "seasonality"
  | "volatility_profile"
  | "volume_profile"
  | "sector_tendency";

export interface KnowledgeEntry {
  /** Unique knowledge ID. */
  id: string;
  /** Type of knowledge. */
  type: KnowledgeType;
  /** Symbol this knowledge applies to (or "MARKET" for universal). */
  symbol: string;
  /** Human-readable name. */
  name: string;
  /** Detailed description. */
  description: string;
  /** The measurable pattern or relationship. */
  pattern: KnowledgePattern;
  /** Confidence level (0-1). */
  confidence: number;
  /** Number of data points supporting this knowledge. */
  sampleSize: number;
  /** Performance statistics from backtesting. */
  performance: KnowledgePerformance;
  /** Market regimes where this knowledge applies. */
  applicableRegimes: MarketRegime[];
  /** Conditions where this knowledge is most valid. */
  conditions: string[];
      /** Knowledge version (incremented on updates). */
  version: number;
  /** When the knowledge was first discovered. */
  discoveredAt: number;
  /** When the knowledge was last validated. */
  lastValidatedAt: number;
  /** When the knowledge was last updated. */
  lastUpdatedAt: number;
  /** Whether this knowledge is currently active. */
  active: boolean;
  /** Rejection reason if the knowledge was invalidated. */
  rejectionReason: string | null;
  /** Source episodes that produced this knowledge. */
  sourceEpisodeIds: string[];
}

export interface KnowledgePattern {
  /** Pattern identifier. */
  patternId: string;
  /** Pattern type. */
  type: "indicator_threshold" | "price_structure" | "volume_pattern" | "correlation_shift" | "regime_transition" | "seasonal" | "custom";
  /** Parameters defining the pattern. */
  parameters: Record<string, number>;
  /** Conditions that must be true for the pattern to activate. */
  conditions: PatternCondition[];
  /** Expected behavior when the pattern is active. */
  expectedBehavior: string;
}

export interface PatternCondition {
  indicator: string;
  operator: ">" | "<" | ">=" | "<=" | "==" | "between" | "crosses_above" | "crosses_below";
  value: number;
  valueUpper?: number;
}

export interface KnowledgePerformance {
  /** Total episodes that tested this knowledge. */
  episodesTested: number;
  /** Episodes where the knowledge was profitable. */
  profitableEpisodes: number;
  /** Average return across episodes. */
  avgReturn: number;
  /** Best return. */
  bestReturn: number;
  /** Worst return. */
  worstReturn: number;
  /** Average Sharpe across episodes. */
  avgSharpe: number;
  /** Win rate across all trades supported by this knowledge. */
  winRate: number;
  /** Profit factor. */
  profitFactor: number;
  /** Average trade expectancy. */
  expectancy: number;
  /** Maximum drawdown observed. */
  maxDrawdown: number;
}

// ── Continuous Learning Pipeline ──────────────────────────

export type PipelineStage =
  | "data_collection"
  | "episode_generation"
  | "blind_simulation"
  | "performance_evaluation"
  | "validation"
  | "knowledge_extraction"
  | "knowledge_integration"
  | "quality_check";

export type PipelineJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "paused";

export interface TrainingJob {
  /** Unique job ID. */
  id: string;
  /** Job name/description. */
  name: string;
  /** Symbols to train on. */
  symbols: string[];
  /** Timeframes to use. */
  intervals: Interval[];
  /** Historical period. */
  startMs: number;
  endMs: number;
  /** Current pipeline stage. */
  currentStage: PipelineStage;
  /** Overall status. */
  status: PipelineJobStatus;
  /** Total episodes to run. */
  totalEpisodes: number;
  /** Episodes completed. */
  completedEpisodes: number;
  /** Episodes failed. */
  failedEpisodes: number;
  /** Current throughput (episodes per second). */
  throughput: number;
  /** Estimated time remaining (ms). */
  estimatedTimeRemaining: number;
  /** When the job was created. */
  createdAt: number;
  /** When the job started. */
  startedAt: number | null;
  /** When the job completed. */
  completedAt: number | null;
  /** Error message if failed. */
  error: string | null;
  /** Checkpoint data. */
  checkpoint: JobCheckpoint | null;
  /** Results summary. */
  summary: JobSummary | null;
}

export interface JobCheckpoint {
  /** Last completed episode index. */
  lastEpisodeIndex: number;
  /** Knowledge version at checkpoint. */
  knowledgeVersion: string;
  /** Performance snapshot. */
  performanceSnapshot: JobPerformanceSnapshot;
  /** Checkpointed at. */
  checkpointedAt: number;
}

export interface JobPerformanceSnapshot {
  totalEpisodesRun: number;
  aggregateWinRate: number;
  aggregateSharpe: number;
  aggregateProfitFactor: number;
  bestPerformingStrategy: string | null;
  worstPerformingStrategy: string | null;
}

export interface JobSummary {
  totalEpisodesRun: number;
  totalTrades: number;
  aggregateWinRate: number;
  aggregateSharpe: number;
  aggregateProfitFactor: number;
  aggregateMaxDrawdown: number;
  knowledgeEntriesCreated: number;
  knowledgeEntriesUpdated: number;
  knowledgeEntriesRejected: number;
  newPatternsDiscovered: number;
  strategyPerformance: Record<string, { winRate: number; sharpe: number; trades: number }>;
}

// ── Knowledge Versioning ──────────────────────────────────

export interface KnowledgeVersion {
  /** Version number (monotonically increasing). */
  version: number;
  /** Hash of the knowledge state. */
  hash: string;
  /** When this version was created. */
  createdAt: number;
  /** Summary of changes from previous version. */
  changes: KnowledgeChange[];
  /** Performance delta from previous version. */
  performanceDelta: {
    winRateChange: number;
    sharpeChange: number;
    entriesAdded: number;
    entriesRemoved: number;
  };
}

export interface KnowledgeChange {
  type: "added" | "updated" | "removed" | "validated" | "invalidated";
  entryId: string;
  entryName: string;
  reason: string;
}

// ── Conversational AI Integration ─────────────────────────

export interface AIQuery {
  /** User's question. */
  question: string;
  /** Symbol(s) the user is asking about. */
  symbols: string[];
  /** Current live market data available. */
  liveData: Record<string, { price: number; change24h: number; volume: number }>;
  /** Knowledge relevant to the query. */
  relevantKnowledge: KnowledgeEntry[];
  /** Current market regime. */
  currentRegime: Record<string, MarketRegime>;
  /** Historical performance data. */
  historicalPerformance: Record<string, EpisodeResult>;
  /** User's stated risk tolerance. */
  riskTolerance: "conservative" | "moderate" | "aggressive";
}

export interface AIResponse {
  /** The AI's recommendation. */
  recommendation: "BUY" | "SELL" | "HOLD" | "WAIT" | "REDUCE";
  /** Confidence in the recommendation (0-1). */
  confidence: number;
  /** Human-readable reasoning. */
  reasoning: string;
  /** Data points that support this recommendation. */
  supportingData: AIDataPoint[];
  /** Data points that contradict this recommendation. */
  contradictingData: AIDataPoint[];
  /** Uncertainty factors. */
  uncertainties: string[];
  /** Risk assessment. */
  riskAssessment: string;
  /** Suggested position sizing (fraction of portfolio). */
  suggestedPositionSize: number | null;
  /** Entry/exit levels if recommending a trade. */
  levels: { entry: number; stopLoss: number; takeProfit: number } | null;
  /** Knowledge version used. */
  knowledgeVersion: number;
  /** Timestamp of the response. */
  generatedAt: number;
}

export interface AIDataPoint {
  label: string;
  value: string;
  source: "live_data" | "knowledge_base" | "model_output" | "historical_pattern" | "regime_intelligence";
  weight: number;
  detail: string;
}

// ── Command Center Dashboard ──────────────────────────────

export interface CommandCenterSnapshot {
  /** Universe overview. */
  universe: {
    totalAssets: number;
    assetsLearned: number;
    assetsInProgress: number;
    assetsRemaining: number;
  };
  /** Training progress. */
  training: {
    totalEpisodesCompleted: number;
    totalEpisodesFailed: number;
    currentJobs: TrainingJob[];
    completedJobs: number;
    throughput: number;
    uptime: number;
  };
  /** Knowledge base status. */
  knowledge: {
    totalEntries: number;
    activeEntries: number;
    validatedEntries: number;
    rejectedEntries: number;
    currentVersion: number;
    lastUpdated: number;
  };
  /** Performance metrics. */
  performance: {
    aggregateWinRate: number;
    aggregateSharpe: number;
    aggregateProfitFactor: number;
    aggregateMaxDrawdown: number;
    bestStrategy: string | null;
    worstStrategy: string | null;
  };
  /** System health. */
  health: {
    dataFeedStatus: "healthy" | "degraded" | "offline";
    lastDataUpdate: number;
    memoryUsage: number;
    cpuUsage: number;
    errorRate: number;
  };
}

// ── Configuration ─────────────────────────────────────────

export interface StockLearningConfig {
  /** Maximum concurrent training workers. */
  maxWorkers: number;
  /** Maximum episodes per job. */
  maxEpisodesPerJob: number;
  /** Default candle interval for training. */
  defaultInterval: Interval;
  /** Historical lookback for training (ms). */
  defaultLookbackMs: number;
  /** Knowledge base maximum entries. */
  maxKnowledgeEntries: number;
  /** Minimum episodes before a pattern is considered validated. */
  minValidationEpisodes: number;
  /** Minimum confidence to activate knowledge. */
  minKnowledgeConfidence: number;
  /** Knowledge decay rate (per day). */
  knowledgeDecayRate: number;
  /** Maximum knowledge age before re-validation (ms). */
  maxKnowledgeAgeMs: number;
  /** Checkpoint interval for resumable jobs (ms). */
  checkpointIntervalMs: number;
}

export const DEFAULT_STOCK_LEARNING_CONFIG: StockLearningConfig = {
  maxWorkers: 4,
  maxEpisodesPerJob: 10_000,
  defaultInterval: "1d",
  defaultLookbackMs: 365 * 24 * 60 * 60 * 1000, // 1 year
  maxKnowledgeEntries: 50_000,
  minValidationEpisodes: 5,
  minKnowledgeConfidence: 0.6,
  knowledgeDecayRate: 0.001, // 0.1% per day
  maxKnowledgeAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  checkpointIntervalMs: 60 * 1000, // 1 minute
};
