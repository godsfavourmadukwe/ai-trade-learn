import { useState, useEffect, useCallback, useRef } from "react";
import { aiEngine, type TradingSignal, type LearningMetrics, type PatternPerformance, type MarketRegime } from "@/lib/ai-engine";

interface UseAISignalsReturn {
  signals: TradingSignal[];
  latestSignal: TradingSignal | null;
  isAnalyzing: boolean;
  learningMetrics: LearningMetrics;
  patternPerformance: PatternPerformance[];
  regime: MarketRegime;
  analyzeSymbol: (symbol: string, currentPrice: number) => TradingSignal;
  feedPrice: (symbol: string, price: number, volume?: number) => void;
  recordOutcome: (signalId: string, outcome: "win" | "loss", pnl: number) => void;
  getPatternWeights: () => Record<string, number>;
  resetLearning: () => void;
}

export function useAISignals(): UseAISignalsReturn {
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [latestSignal, setLatestSignal] = useState<TradingSignal | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [learningMetrics, setLearningMetrics] = useState<LearningMetrics>(aiEngine.getMetrics());
  const [patternPerformance, setPatternPerformance] = useState<PatternPerformance[]>(aiEngine.getPatternPerformance());
  const [regime, setRegime] = useState<MarketRegime>(aiEngine.getRegime());

  const lastPriceRef = useRef<Record<string, number>>({});
  const signalHistoryRef = useRef<Map<string, TradingSignal>>(new Map());
  const evalIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const decayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metricsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Feed real price data into the engine
  const feedPrice = useCallback((symbol: string, price: number, volume?: number) => {
    if (price <= 0) return;
    aiEngine.updatePrice(symbol, price, volume);
  }, []);

  // Analyze a symbol and generate signal
  const analyzeSymbol = useCallback((symbol: string, _currentPrice: number): TradingSignal => {
    setIsAnalyzing(true);

    // Generate signal from real price data
    const signal = aiEngine.analyzeMarket(symbol);

    // Store signal
    signalHistoryRef.current.set(signal.id, signal);

    // Update state
    setLatestSignal(signal);
    setSignals((prev) => [signal, ...prev].slice(0, 50));

    setIsAnalyzing(false);
    return signal;
  }, []);

  // Record trade outcome for manual learning
  const recordOutcome = useCallback((signalId: string, outcome: "win" | "loss", pnl: number) => {
    const signal = signalHistoryRef.current.get(signalId);
    if (signal) {
      aiEngine.learnFromOutcome(signal, outcome, pnl);
      refreshMetrics();
    }
  }, []);

  // Get pattern weights
  const getPatternWeights = useCallback(() => {
    return aiEngine.getPatternWeights();
  }, []);

  // Reset learning
  const resetLearning = useCallback(() => {
    aiEngine.reset();
    setSignals([]);
    setLatestSignal(null);
    signalHistoryRef.current.clear();
    refreshMetrics();
  }, []);

  // Refresh all metrics from engine
  const refreshMetrics = useCallback(() => {
    setLearningMetrics(aiEngine.getMetrics());
    setPatternPerformance(aiEngine.getPatternPerformance());
    setRegime(aiEngine.getRegime());
  }, []);

  // ---- Autonomous Learning Loop ----

  // 1. Auto-evaluate pending signals every 30 seconds
  useEffect(() => {
    evalIntervalRef.current = setInterval(() => {
      aiEngine.evaluatePendingSignals();
      refreshMetrics();
    }, 30000);

    return () => {
      if (evalIntervalRef.current) clearInterval(evalIntervalRef.current);
    };
  }, [refreshMetrics]);

  // 2. Weight decay every 5 minutes
  useEffect(() => {
    decayIntervalRef.current = setInterval(() => {
      aiEngine.decayWeights();
    }, 5 * 60 * 1000);

    return () => {
      if (decayIntervalRef.current) clearInterval(decayIntervalRef.current);
    };
  }, []);

  // 3. Refresh UI metrics every 5 seconds
  useEffect(() => {
    metricsIntervalRef.current = setInterval(refreshMetrics, 5000);
    return () => {
      if (metricsIntervalRef.current) clearInterval(metricsIntervalRef.current);
    };
  }, [refreshMetrics]);

  return {
    signals,
    latestSignal,
    isAnalyzing,
    learningMetrics,
    patternPerformance,
    regime,
    analyzeSymbol,
    feedPrice,
    recordOutcome,
    getPatternWeights,
    resetLearning,
  };
}
