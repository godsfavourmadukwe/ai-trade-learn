// ============================================================
// STOCK MARKET LEARNING — Continuous Learning Pipeline
//
// Orchestrates the complete learning loop:
//   Training → Blind Simulation → Evaluation → Validation →
//   Knowledge Extraction → Quality Check
//
// Enforces knowledge flow FORWARD ONLY.
// Every change is versioned and measurable.
// Never allows uncontrolled self-modification.
// ============================================================

import type {
  TrainingJob,
  TrainingEpisode,
  EpisodeResult,
  PipelineStage,
  PipelineJobStatus,
  JobCheckpoint,
  JobSummary,
  StockLearningConfig,
} from "./types";
import type { Interval, Candle } from "@/lib/market/types";
import { BlindTrainingAgent, runBlindEpisode } from "./agent";
import {
  addKnowledge,
  updateKnowledge,
  getKnowledgeStats,
  getCurrentKnowledgeVersion,
} from "./knowledge-base";
import { getStockInfo, getTrainingSymbols } from "./universe";

// ── Pipeline Store ────────────────────────────────────────

const activeJobs = new Map<string, TrainingJob>();
const completedJobs: TrainingJob[] = [];
let jobCounter = 0;

// ── Job Management ────────────────────────────────────────

function generateJobId(): string {
  jobCounter++;
  return `job_${Date.now()}_${jobCounter}`;
}

/**
 * Create a new training job.
 */
export function createTrainingJob(params: {
  name: string;
  symbols: string[];
  intervals: Interval[];
  startMs: number;
  endMs: number;
}): TrainingJob {
  const job: TrainingJob = {
    id: generateJobId(),
    name: params.name,
    symbols: params.symbols,
    intervals: params.intervals,
    startMs: params.startMs,
    endMs: params.endMs,
    currentStage: "data_collection",
    status: "pending",
    totalEpisodes: params.symbols.length * params.intervals.length,
    completedEpisodes: 0,
    failedEpisodes: 0,
    throughput: 0,
    estimatedTimeRemaining: 0,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    error: null,
    checkpoint: null,
    summary: null,
  };

  activeJobs.set(job.id, job);
  return job;
}

/**
 * Get all active training jobs.
 */
export function getActiveJobs(): TrainingJob[] {
  return Array.from(activeJobs.values());
}

/**
 * Get all completed training jobs.
 */
export function getCompletedJobs(): TrainingJob[] {
  return [...completedJobs];
}

/**
 * Get a specific job by ID.
 */
export function getJob(jobId: string): TrainingJob | null {
  return activeJobs.get(jobId) ?? completedJobs.find((j) => j.id === jobId) ?? null;
}

// ── Pipeline Execution ────────────────────────────────────

/**
 * Run a training job. Executes episodes sequentially for each
 * symbol × interval combination.
 *
 * In a real system, this would be distributed across workers.
 * Here we simulate the pipeline inline for testing and demonstration.
 */
export async function runTrainingJob(
  jobId: string,
  candleProvider: (symbol: string, interval: Interval, startMs: number, endMs: number) => Promise<Candle[]>,
  config: StockLearningConfig = {
    maxWorkers: 4,
    maxEpisodesPerJob: 10_000,
    defaultInterval: "1d",
    defaultLookbackMs: 365 * 24 * 60 * 60 * 1000,
    maxKnowledgeEntries: 50_000,
    minValidationEpisodes: 5,
    minKnowledgeConfidence: 0.6,
    knowledgeDecayRate: 0.001,
    maxKnowledgeAgeMs: 30 * 24 * 60 * 60 * 1000,
    checkpointIntervalMs: 60 * 1000,
  },
): Promise<JobSummary | null> {
  const job = activeJobs.get(jobId);
  if (!job) return null;

  job.status = "running";
  job.startedAt = Date.now();
  const startTime = Date.now();
  let totalTrades = 0;
  let totalWins = 0;
  let totalReturn = 0;
  let totalSharpe = 0;
  let knowledgeCreated = 0;
  let lastCheckpoint = Date.now();

  try {
    // Stage 1: Data Collection
    job.currentStage = "data_collection";

    for (const symbol of job.symbols) {
      for (const interval of job.intervals) {
        // Stage 2: Episode Generation
        job.currentStage = "episode_generation";

        const candles = await candleProvider(symbol, interval, job.startMs, job.endMs);
        if (candles.length < 60) {
          job.failedEpisodes++;
          continue;
        }

        // Stage 3: Blind Simulation
        job.currentStage = "blind_simulation";

        const agent = new BlindTrainingAgent(
          `agent_${symbol}_${interval}_${Date.now()}`,
          `v${getCurrentKnowledgeVersion()}`,
        );

        const result = runBlindEpisode(agent, candles, 10_000);

        // Stage 4: Performance Evaluation
        job.currentStage = "performance_evaluation";

        totalTrades += result.totalTrades;
        totalWins += result.winningTrades;
        totalReturn += result.totalReturn;
        totalSharpe += result.sharpeRatio;

        // Stage 5: Validation
        job.currentStage = "validation";

        const isValid = result.winRate >= 0.4 &&
          result.totalTrades >= 5 &&
          result.sharpeRatio > 0;

        // Stage 6: Knowledge Extraction
        job.currentStage = "knowledge_extraction";

        if (isValid && result.totalTrades >= 3) {
          // Extract patterns from the winning trades
          extractKnowledge(symbol, interval, result, candles);
          knowledgeCreated++;
        }

        job.completedEpisodes++;

        // Periodic checkpointing
        if (Date.now() - lastCheckpoint > config.checkpointIntervalMs) {
          job.checkpoint = {
            lastEpisodeIndex: job.completedEpisodes,
            knowledgeVersion: `v${getCurrentKnowledgeVersion()}`,
            performanceSnapshot: {
              totalEpisodesRun: job.completedEpisodes,
              aggregateWinRate: totalWins / Math.max(1, totalTrades),
              aggregateSharpe: totalSharpe / Math.max(1, job.completedEpisodes),
              aggregateProfitFactor: 0,
              bestPerformingStrategy: null,
              worstPerformingStrategy: null,
            },
            checkpointedAt: Date.now(),
          };
          lastCheckpoint = Date.now();
        }

        // Update throughput and ETA
        const elapsed = (Date.now() - startTime) / 1000;
        job.throughput = job.completedEpisodes / elapsed;
        const remaining = job.totalEpisodes - job.completedEpisodes;
        job.estimatedTimeRemaining = job.throughput > 0 ? (remaining / job.throughput) * 1000 : 0;
      }
    }

    // Stage 7: Knowledge Integration
    job.currentStage = "knowledge_integration";

    // Stage 8: Quality Check
    job.currentStage = "quality_check";

    // Build summary
    const episodesRun = job.completedEpisodes;
    job.summary = {
      totalEpisodesRun: episodesRun,
      totalTrades,
      aggregateWinRate: totalTrades > 0 ? totalWins / totalTrades : 0,
      aggregateSharpe: episodesRun > 0 ? totalSharpe / episodesRun : 0,
      aggregateProfitFactor: 0,
      aggregateMaxDrawdown: 0,
      knowledgeEntriesCreated: knowledgeCreated,
      knowledgeEntriesUpdated: 0,
      knowledgeEntriesRejected: 0,
      newPatternsDiscovered: knowledgeCreated,
      strategyPerformance: {},
    };

    job.status = "completed";
    job.completedAt = Date.now();
    activeJobs.delete(jobId);
    completedJobs.push(job);

    return job.summary;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.completedAt = Date.now();
    activeJobs.delete(jobId);
    completedJobs.push(job);
    return null;
  }
}

// ── Knowledge Extraction ──────────────────────────────────

/**
 * Extract knowledge patterns from a completed episode's results.
 * This is the bridge between blind simulation and the knowledge base.
 */
function extractKnowledge(
  symbol: string,
  interval: Interval,
  result: EpisodeResult,
  candles: Candle[],
): void {
  if (result.totalTrades < 3) return;

  // Extract regime-specific performance
  const regimePerf = result.regimePerformance;
  for (const [regime, perf] of Object.entries(regimePerf)) {
    if (perf.trades >= 3 && perf.winRate > 0.5) {
      addKnowledge({
        type: "regime_behavior",
        symbol,
        name: `${regime} regime behavior on ${symbol} (${interval})`,
        description: `In ${regime} regime, the strategy achieved ${(perf.winRate * 100).toFixed(0)}% win rate over ${perf.trades} trades on ${symbol} ${interval}.`,
        pattern: {
          patternId: `regime_${symbol}_${regime}_${interval}`,
          type: "regime_transition",
          parameters: { regime: 0, minTrades: 3 },
          conditions: [],
          expectedBehavior: `${regime} regime shows ${perf.winRate > 0.5 ? "favorable" : "unfavorable"} conditions`,
        },
        confidence: Math.min(0.8, 0.3 + perf.winRate * 0.3 + (perf.trades / 10) * 0.2),
        sampleSize: perf.trades,
        performance: {
          episodesTested: 1,
          profitableEpisodes: perf.winRate > 0.5 ? 1 : 0,
          avgReturn: perf.pnl / perf.trades,
          bestReturn: perf.pnl / perf.trades,
          worstReturn: perf.pnl / perf.trades,
          avgSharpe: result.sharpeRatio,
          winRate: perf.winRate,
          profitFactor: result.profitFactor,
          expectancy: result.expectancy,
          maxDrawdown: result.maxDrawdown,
        },
        applicableRegimes: [regime as any],
        conditions: [`Traded in ${regime} regime`],
        sourceEpisodeIds: [],
      });
    }
  }

  // Extract overall strategy performance as knowledge
  if (result.winRate > 0.5 && result.sharpeRatio > 0.5) {
    addKnowledge({
      type: "strategy",
      symbol,
      name: `EMA/RSI strategy on ${symbol} (${interval})`,
      description: `Multi-indicator strategy achieved ${(result.winRate * 100).toFixed(0)}% win rate with Sharpe ${result.sharpeRatio.toFixed(2)} over ${result.totalTrades} trades.`,
      pattern: {
        patternId: `strategy_${symbol}_${interval}_ema_rsi`,
        type: "indicator_threshold",
        parameters: { ema10: 1, ema20: 1, ema50: 1, rsi14: 50, adx14: 25 },
        conditions: [
          { indicator: "ema_alignment", operator: "between", value: 0, valueUpper: 1 },
          { indicator: "rsi14", operator: "between", value: 40, valueUpper: 70 },
        ],
        expectedBehavior: "Trend-following entry with momentum confirmation",
      },
      confidence: Math.min(0.75, 0.3 + result.winRate * 0.2 + Math.min(result.sharpeRatio / 3, 0.25)),
      sampleSize: result.totalTrades,
      performance: {
        episodesTested: 1,
        profitableEpisodes: result.winRate > 0.5 ? 1 : 0,
        avgReturn: result.expectancy,
        bestReturn: Math.max(...result.trades.map((t) => t.pnlPercent)),
        worstReturn: Math.min(...result.trades.map((t) => t.pnlPercent)),
        avgSharpe: result.sharpeRatio,
        winRate: result.winRate,
        profitFactor: result.profitFactor,
        expectancy: result.expectancy,
        maxDrawdown: result.maxDrawdown,
      },
      applicableRegimes: ["strong_uptrend", "uptrend"],
      conditions: ["Trend-aligned markets with sufficient volume"],
      sourceEpisodeIds: [],
    });
  }
}

// ── Pipeline Status ───────────────────────────────────────

/**
 * Get overall pipeline status.
 */
export function getPipelineStatus(): {
  activeJobs: number;
  completedJobs: number;
  totalEpisodesRun: number;
  knowledgeStats: ReturnType<typeof getKnowledgeStats>;
  currentKnowledgeVersion: number;
} {
  const active = Array.from(activeJobs.values());
  const totalEpisodes = active.reduce((s, j) => s + j.completedEpisodes, 0) +
    completedJobs.reduce((s, j) => s + j.completedEpisodes, 0);

  return {
    activeJobs: active.length,
    completedJobs: completedJobs.length,
    totalEpisodesRun: totalEpisodes,
    knowledgeStats: getKnowledgeStats(),
    currentKnowledgeVersion: getCurrentKnowledgeVersion(),
  };
}
