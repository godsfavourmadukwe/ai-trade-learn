import { useState, useEffect, useCallback, useRef } from "react";
import { arenaEngine, type ArenaSnapshot } from "@/lib/arena/engine";
import type {
  ArenaTrade,
  ArenaSignal,
  ArenaPerformanceSummary,
} from "@/lib/arena/types";
import type { ArenaStatusInfo } from "@/lib/arena/engine";

interface UseArenaReturn {
  trades: ArenaTrade[];
  signals: ArenaSignal[];
  performance: ArenaPerformanceSummary;
  status: ArenaStatusInfo;
  isActive: boolean;
  start: () => void;
  stop: () => void;
  getAdaptiveThresholds: () => { confidence: number; minRR: number };
  getModelVersion: () => string;
}

const defaultPerformance: ArenaPerformanceSummary = {
  totalTrades: 0,
  openTrades: 0,
  closedTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  totalPnl: 0,
  winRate: 0,
  profitFactor: 0,
  expectancy: 0,
  averageWin: 0,
  averageLoss: 0,
  averageHoldingSeconds: 0,
  maxDrawdown: 0,
  sharpeRatio: 0,
  sortinoRatio: 0,
  modelVersion: "arena_v1.0.0",
  featuresVersion: "feat_v1.0.0",
  firstTradeTime: null,
  lastTradeTime: null,
};

const defaultStatus: ArenaStatusInfo = {
  enabled: false,
  modelVersion: "arena_v1.0.0",
  paused: false,
  dataHealth: {
    feedHealth: "unknown",
    lastTickMsAgo: 0,
    lastCandleAgeMsAgo: 0,
    hasGaps: false,
    provider: "—",
  },
  lastDecisionTime: null,
  decisionsToday: 0,
  openPositions: 0,
  capital: 10_000,
};

export function useArena(): UseArenaReturn {
  const [snapshot, setSnapshot] = useState<ArenaSnapshot | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const unsubscribe = arenaEngine.subscribe((snap) => {
      if (mountedRef.current) setSnapshot(snap);
    });

    // Auto-start the arena engine
    arenaEngine.start();

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  const start = useCallback(() => {
    arenaEngine.start();
  }, []);

  const stop = useCallback(() => {
    arenaEngine.stop();
  }, []);

  return {
    trades: snapshot?.trades ?? [],
    signals: snapshot?.signals ?? [],
    performance: snapshot?.performance ?? defaultPerformance,
    status: snapshot?.status ?? defaultStatus,
    isActive: arenaEngine.isActive(),
    start,
    stop,
    getAdaptiveThresholds: () => arenaEngine.getAdaptiveThresholds(),
    getModelVersion: () => arenaEngine.getModelVersion(),
  };
}
