// ============================================================
// TRADSLY AI Engine compatibility shim
// Existing dashboard consumers import symbols from this module.
// New AI TRADE ARENA code should use the shared arena types
// under @/lib/arena instead of continuing to extend this shim.
// ============================================================

import type { MarketRegime as ArenaRegime } from "@/lib/arena/types";

// Re-export the existing dashboard shapes so current imports keep compiling.
// These are intentionally kept minimal and are not the real arena model.
export interface TradingSignal {
  id: string;
  symbol: string;
  timestamp: number;
  action: "buy" | "sell" | "hold";
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  reasons: string[];
  patterns: unknown[];
  indicators: unknown;
  expectedDuration: string;
  aiConfidence: number;
  regime: ArenaRegime;
}

export interface LearningMetrics {
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  patternAccuracy: Record<string, { correct: number; total: number }>;
  bestPerformingPatterns: string[];
  worstPerformingPatterns: string[];
  averageConfidence: number;
  lastUpdated: number;
  totalSignalsTracked: number;
  signalsWinning: number;
  signalsLosing: number;
  signalsPending: number;
  avgHoldingReturn: number;
  currentStreak: number;
  streakType: "win" | "loss" | null;
  regimeHistory: Record<ArenaRegime, { signals: number; accuracy: number }>;
  evolutionScore: number;
  discoveryCount: number;
  selfAdjustments: number;
}

export interface PatternPerformance {
  pattern: string;
  total: number;
  correct: number;
  accuracy: number;
  weight: number;
  lastSeen: number;
  recentAccuracy: number;
  discoveredAt: number;
}

export type MarketRegime = (typeof _marketRegimeUnion)[number];

/** Temporary union kept only to satisfy existing dashboard consumers. The
real arena uses @/lib/arena/types.MarketRegime. */
const _marketRegimeUnion = [
  "strong_uptrend",
  "uptrend",
  "ranging",
  "downtrend",
  "strong_downtrend",
  "high_volatility",
  "low_volatility",
  "unknown",
] as const;

// Keep a tiny in-memory singleton so the dashboard hooks do not crash on load.
const dummySignal: TradingSignal = {
  id: "shim_signal",
  symbol: "BTC/USDT",
  timestamp: Date.now(),
  action: "hold",
  confidence: 50,
  entryPrice: 0,
  stopLoss: 0,
  takeProfit: 0,
  riskReward: 1,
  reasons: [],
  patterns: [],
  indicators: {},
  expectedDuration: "n/a",
  aiConfidence: 50,
  regime: "ranging",
};

const dummyMetrics: LearningMetrics = {
  totalPredictions: 0,
  correctPredictions: 0,
  accuracy: 0,
  patternAccuracy: {},
  bestPerformingPatterns: [],
  worstPerformingPatterns: [],
  averageConfidence: 50,
  lastUpdated: Date.now(),
  totalSignalsTracked: 0,
  signalsWinning: 0,
  signalsLosing: 0,
  signalsPending: 0,
  avgHoldingReturn: 0,
  currentStreak: 0,
  streakType: null,
  regimeHistory: {
    strong_uptrend: { signals: 0, accuracy: 0 },
    uptrend: { signals: 0, accuracy: 0 },
    ranging: { signals: 0, accuracy: 0 },
    downtrend: { signals: 0, accuracy: 0 },
    strong_downtrend: { signals: 0, accuracy: 0 },
    high_volatility: { signals: 0, accuracy: 0 },
    low_volatility: { signals: 0, accuracy: 0 },
    unknown: { signals: 0, accuracy: 0 },
  },
  evolutionScore: 0,
  discoveryCount: 0,
  selfAdjustments: 0,
};

export const aiEngine = {
  getMetrics: () => dummyMetrics,
  getPatternPerformance: () => [],
  getPatternWeights: () => ({} as Record<string, number>),
  getRegime: () => "ranging" as ArenaRegime,
  updatePrice: (_symbol: string, _price: number, _volume?: number) => {},
  analyzeMarket: (_symbol: string) => dummySignal,
  learnFromOutcome: (_signal: TradingSignal, _outcome: string, _pnl: number) => {},
  evaluatePendingSignals: () => {},
  decayWeights: () => {},
  reset: () => {},
};
