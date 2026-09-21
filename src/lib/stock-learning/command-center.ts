// ============================================================
// STOCK MARKET LEARNING — AI Command Center
//
// Dashboard types and monitoring for the autonomous learning
// system. Shows training progress, knowledge growth, and
// system health.
// ============================================================

import type {
  CommandCenterSnapshot,
  TrainingJob,
  KnowledgeEntry,
} from "./types";
import { getUniverseSnapshot, getUniverseStats, queryUniverse } from "./universe";
import {
  getKnowledgeStats,
  getTopKnowledge,
  getCurrentKnowledgeVersion,
} from "./knowledge-base";
import {
  getActiveJobs,
  getCompletedJobs,
  getPipelineStatus,
} from "./pipeline";

// ── Command Center ────────────────────────────────────────

/**
 * Generate a full command center snapshot.
 */
export function getCommandCenterSnapshot(): CommandCenterSnapshot {
  const universe = getUniverseSnapshot();
  const universeStats = getUniverseStats();
  const knowledgeStats = getKnowledgeStats();
  const pipelineStatus = getPipelineStatus();
  const activeJobs = getActiveJobs();
  const completedJobs = getCompletedJobs();
  const topKnowledge = getTopKnowledge(5);

  // Compute learning progress
  const assetsLearned = new Set(
    knowledgeStats.bySymbol ? Object.keys(knowledgeStats.bySymbol) : [],
  ).size;

  const currentJobs = activeJobs.map((j) => ({
    ...j,
  }));

  return {
    universe: {
      totalAssets: universe.totalCount,
      assetsLearned,
      assetsInProgress: currentJobs.reduce((s, j) => s + j.symbols.length, 0),
      assetsRemaining: Math.max(0, universe.totalCount - assetsLearned),
    },
    training: {
      totalEpisodesCompleted: pipelineStatus.totalEpisodesRun,
      totalEpisodesFailed: completedJobs.reduce((s, j) => s + j.failedEpisodes, 0),
      currentJobs,
      completedJobs: completedJobs.length,
      throughput: activeJobs.length > 0
        ? activeJobs.reduce((s, j) => s + j.throughput, 0)
        : 0,
      uptime: completedJobs.length > 0
        ? Date.now() - Math.min(...completedJobs.map((j) => j.startedAt ?? j.createdAt))
        : 0,
    },
    knowledge: {
      totalEntries: knowledgeStats.total,
      activeEntries: knowledgeStats.active,
      validatedEntries: knowledgeStats.validated,
      rejectedEntries: knowledgeStats.rejected,
      currentVersion: getCurrentKnowledgeVersion(),
      lastUpdated: Date.now(),
    },
    performance: {
      aggregateWinRate: pipelineStatus.totalEpisodesRun > 0
        ? completedJobs.reduce((s, j) => s + (j.summary?.aggregateWinRate ?? 0) * (j.summary?.totalTrades ?? 0), 0) /
          Math.max(1, completedJobs.reduce((s, j) => s + (j.summary?.totalTrades ?? 0), 0))
        : 0,
      aggregateSharpe: completedJobs.length > 0
        ? completedJobs.reduce((s, j) => s + (j.summary?.aggregateSharpe ?? 0), 0) / completedJobs.length
        : 0,
      aggregateProfitFactor: 0,
      aggregateMaxDrawdown: 0,
      bestStrategy: topKnowledge.length > 0 ? topKnowledge[0].name : null,
      worstStrategy: null,
    },
    health: {
      dataFeedStatus: "healthy",
      lastDataUpdate: Date.now(),
      memoryUsage: 0,
      cpuUsage: 0,
      errorRate: 0,
    },
  };
}

/**
 * Get training progress for a specific job.
 */
export function getJobProgress(jobId: string): {
  job: TrainingJob | null;
  percentComplete: number;
  stageProgress: Record<string, number>;
} {
  const job = getActiveJobs().find((j) => j.id === jobId) ??
    getCompletedJobs().find((j) => j.id === jobId);

  if (!job) return { job: null, percentComplete: 0, stageProgress: {} };

  const percentComplete = job.totalEpisodes > 0
    ? (job.completedEpisodes / job.totalEpisodes) * 100
    : 0;

  const stages = ["data_collection", "episode_generation", "blind_simulation", "performance_evaluation", "validation", "knowledge_extraction", "knowledge_integration", "quality_check"];
  const currentStageIdx = stages.indexOf(job.currentStage);

  const stageProgress: Record<string, number> = {};
  for (let i = 0; i < stages.length; i++) {
    if (i < currentStageIdx) stageProgress[stages[i]] = 100;
    else if (i === currentStageIdx) stageProgress[stages[i]] = percentComplete;
    else stageProgress[stages[i]] = 0;
  }

  return { job, percentComplete, stageProgress };
}

/**
 * Get knowledge growth over time (for charting).
 */
export function getKnowledgeGrowthTimeline(): {
  timestamp: number;
  totalEntries: number;
  activeEntries: number;
  version: number;
}[] {
  // Simplified: return current state as a single point
  // In production, this would query historical snapshots
  const stats = getKnowledgeStats();
  return [{
    timestamp: Date.now(),
    totalEntries: stats.total,
    activeEntries: stats.active,
    version: getCurrentKnowledgeVersion(),
  }];
}

/**
 * Get best and worst performing strategies.
 */
export function getStrategyRankings(): {
  strategy: string;
  symbol: string;
  winRate: number;
  sharpe: number;
  trades: number;
  confidence: number;
}[] {
  const topKnowledge = getTopKnowledge(50);
  return topKnowledge
    .filter((k) => k.type === "strategy")
    .map((k) => ({
      strategy: k.name,
      symbol: k.symbol,
      winRate: k.performance.winRate,
      sharpe: k.performance.avgSharpe,
      trades: k.performance.episodesTested,
      confidence: k.confidence,
    }))
    .sort((a, b) => b.sharpe - a.sharpe);
}
