import { useState, useEffect, useCallback, useRef } from "react";
import { aiEngine, type TradingSignal, type LearningMetrics } from "@/lib/ai-engine";

interface PriceData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface UseAISignalsReturn {
  signals: TradingSignal[];
  latestSignal: TradingSignal | null;
  isAnalyzing: boolean;
  learningMetrics: LearningMetrics;
  analyzeSymbol: (symbol: string, currentPrice: number) => TradingSignal;
  recordOutcome: (signalId: string, outcome: "win" | "loss", pnl: number) => void;
  getPatternWeights: () => Record<string, number>;
  resetLearning: () => void;
}

// Generate simulated OHLCV data from current price
function generateOHLCV(currentPrice: number, points: number = 100): PriceData[] {
  const data: PriceData[] = [];
  let price = currentPrice * 0.97;
  
  for (let i = 0; i < points; i++) {
    const volatility = 0.02;
    const change = (Math.random() - 0.48) * price * volatility;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * price * 0.01;
    const low = Math.min(open, close) - Math.random() * price * 0.01;
    const volume = Math.random() * 10000000 + 1000000;
    
    data.push({
      time: Date.now() - (points - i) * 60000,
      open,
      high,
      low,
      close,
      volume,
    });
    
    price = close;
  }
  
  // Ensure last point is close to current price
  if (data.length > 0) {
    data[data.length - 1].close = currentPrice;
    data[data.length - 1].high = Math.max(data[data.length - 1].high, currentPrice);
    data[data.length - 1].low = Math.min(data[data.length - 1].low, currentPrice);
  }
  
  return data;
}

export function useAISignals(refreshInterval: number = 60000): UseAISignalsReturn {
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [latestSignal, setLatestSignal] = useState<TradingSignal | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [learningMetrics, setLearningMetrics] = useState<LearningMetrics>(
    aiEngine.getMetrics()
  );
  
  const lastPriceRef = useRef<Record<string, number>>({});
  const signalHistoryRef = useRef<Map<string, TradingSignal>>(new Map());

  // Analyze a symbol and generate signal
  const analyzeSymbol = useCallback((symbol: string, currentPrice: number): TradingSignal => {
    setIsAnalyzing(true);
    
    // Generate price data
    const priceData = generateOHLCV(currentPrice);
    
    // Run AI analysis
    const signal = aiEngine.analyzeMarket(symbol, priceData);
    
    // Store signal
    signalHistoryRef.current.set(signal.id, signal);
    
    // Update state
    setLatestSignal(signal);
    setSignals(prev => {
      const newSignals = [signal, ...prev].slice(0, 50); // Keep last 50 signals
      return newSignals;
    });
    
    setIsAnalyzing(false);
    
    return signal;
  }, []);

  // Record trade outcome for learning
  const recordOutcome = useCallback((signalId: string, outcome: "win" | "loss", pnl: number) => {
    const signal = signalHistoryRef.current.get(signalId);
    if (signal) {
      aiEngine.learnFromOutcome(signal, outcome, pnl);
      setLearningMetrics(aiEngine.getMetrics());
    }
  }, []);

  // Get pattern weights
  const getPatternWeights = useCallback(() => {
    return aiEngine.getPatternWeights();
  }, []);

  // Reset learning
  const resetLearning = useCallback(() => {
    aiEngine.reset();
    setLearningMetrics(aiEngine.getMetrics());
    setSignals([]);
    setLatestSignal(null);
    signalHistoryRef.current.clear();
  }, []);

  // Auto-analyze when prices change
  const onPriceUpdate = useCallback((symbol: string, price: number) => {
    const lastPrice = lastPriceRef.current[symbol];
    
    // Only analyze if price changed significantly (>0.1%)
    if (!lastPrice || Math.abs(price - lastPrice) / lastPrice > 0.001) {
      lastPriceRef.current[symbol] = price;
      analyzeSymbol(symbol, price);
    }
  }, [analyzeSymbol]);

  // Update learning metrics periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setLearningMetrics(aiEngine.getMetrics());
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  return {
    signals,
    latestSignal,
    isAnalyzing,
    learningMetrics,
    analyzeSymbol,
    recordOutcome,
    getPatternWeights,
    resetLearning,
    onPriceUpdate,
  } as UseAISignalsReturn;
}
