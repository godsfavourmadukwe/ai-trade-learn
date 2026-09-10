// ============================================================
// TRADSLY Autonomous AI Trading Engine
// Self-learning system that evolves through market observation
// ============================================================

export interface PricePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  atr: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  volumeMA: number;
  vwap: number;
  atrPercent: number;
}

export interface PatternMatch {
  pattern: string;
  confidence: number;
  expectedMove: "bullish" | "bearish" | "neutral";
  timeframe: string;
  weight: number;
  historicalAccuracy: number;
  sampleSize: number;
}

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
  patterns: PatternMatch[];
  indicators: TechnicalIndicators;
  expectedDuration: string;
  aiConfidence: number;
  regime: MarketRegime;
}

export type MarketRegime =
  | "strong_uptrend"
  | "uptrend"
  | "ranging"
  | "downtrend"
  | "strong_downtrend"
  | "high_volatility"
  | "low_volatility";

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
  regimeHistory: Record<MarketRegime, { signals: number; accuracy: number }>;
  evolutionScore: number;
  discoveryCount: number;
  selfAdjustments: number;
}

interface PendingSignalEval {
  signalId: string;
  symbol: string;
  signal: TradingSignal;
  entryPrice: number;
  entryTime: number;
  checkpoints: {
    targetTime: number;
    evaluated: boolean;
    priceAtTime: number | null;
    directionCorrect: boolean | null;
  }[];
}

// --- Technical Calculations ---

function calcEma(data: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < Math.min(period, data.length); i++) sum += data[i];
  result.push(sum / Math.min(period, data.length));
  for (let i = period; i < data.length; i++) {
    result.push(data[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

function calcSma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

function calcRsi(data: number[], period: number = 14): number {
  if (data.length < period + 1) return 50;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcAtr(points: PricePoint[], period: number = 14): number {
  if (points.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const hl = points[i].high - points[i].low;
    const hc = Math.abs(points[i].high - points[i - 1].close);
    const lc = Math.abs(points[i].low - points[i - 1].close);
    trs.push(Math.max(hl, hc, lc));
  }
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return atrVal;
}

function calcMacd(data: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = calcEma(data, 12);
  const ema26 = calcEma(data, 26);
  if (ema12.length === 0 || ema26.length === 0) return { macd: 0, signal: 0, histogram: 0 };
  const offset = ema12.length - ema26.length;
  const macdLine: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i]);
  }
  const signalLine = calcEma(macdLine, 9);
  const lastMacd = macdLine[macdLine.length - 1] || 0;
  const lastSignal = signalLine[signalLine.length - 1] || 0;
  return { macd: lastMacd, signal: lastSignal, histogram: lastMacd - lastSignal };
}

function calcBollinger(data: number[], period: number = 20, mult: number = 2) {
  if (data.length < period) {
    const last = data[data.length - 1] || 0;
    return { upper: last * 1.02, middle: last, lower: last * 0.98 };
  }
  const slice = data.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
}

// --- Constants ---

const STORAGE_KEY = "tradslly_ai_engine_v2";
const SIGNAL_EVAL_KEY = "tradslly_pending_evaluations";
const PRICE_HISTORY_KEY = "tradslly_price_history";
const EVAL_CHECKPOINTS_MINUTES = [15, 60, 240, 1440];
const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 3.0;
const LEARNING_RATE = 0.08;
const DECAY_RATE = 0.995;

function now(): number { return Date.now(); }

// --- AI Engine ---

export class AIEngine {
  private metrics: LearningMetrics;
  private patternPerf: Record<string, PatternPerformance>;
  private pendingEvals: PendingSignalEval[];
  private priceHistory: Record<string, PricePoint[]>;
  private lastRegime: MarketRegime = "ranging";

  constructor() {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.metrics = parsed.metrics;
        this.patternPerf = parsed.patternPerf || {};
      } catch {
        this.metrics = this.defaultMetrics();
        this.patternPerf = {};
      }
    } else {
      this.metrics = this.defaultMetrics();
      this.patternPerf = {};
    }

    const savedEvals = typeof window !== "undefined" ? localStorage.getItem(SIGNAL_EVAL_KEY) : null;
    this.pendingEvals = savedEvals ? JSON.parse(savedEvals) : [];

    const savedPrices = typeof window !== "undefined" ? localStorage.getItem(PRICE_HISTORY_KEY) : null;
    this.priceHistory = savedPrices ? JSON.parse(savedPrices) : {};
  }

  private defaultMetrics(): LearningMetrics {
    return {
      totalPredictions: 0, correctPredictions: 0, accuracy: 0,
      patternAccuracy: {}, bestPerformingPatterns: [], worstPerformingPatterns: [],
      averageConfidence: 50, lastUpdated: Date.now(),
      totalSignalsTracked: 0, signalsWinning: 0, signalsLosing: 0, signalsPending: 0,
      avgHoldingReturn: 0, currentStreak: 0, streakType: null,
      regimeHistory: {
        strong_uptrend: { signals: 0, accuracy: 0 }, uptrend: { signals: 0, accuracy: 0 },
        ranging: { signals: 0, accuracy: 0 }, downtrend: { signals: 0, accuracy: 0 },
        strong_downtrend: { signals: 0, accuracy: 0 }, high_volatility: { signals: 0, accuracy: 0 },
        low_volatility: { signals: 0, accuracy: 0 },
      },
      evolutionScore: 0, discoveryCount: 0, selfAdjustments: 0,
    };
  }

  // ---- Price Data ----

  updatePrice(symbol: string, price: number, volume?: number): void {
    if (!this.priceHistory[symbol]) this.priceHistory[symbol] = [];
    const pts = this.priceHistory[symbol];
    const last = pts[pts.length - 1];
    if (last && now() - last.time < 60000) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += volume || 0;
    } else {
      pts.push({ time: now(), open: last ? last.close : price, high: price, low: price, close: price, volume: volume || 0 });
    }
    if (pts.length > 1440) pts.shift();
  }

  getHistory(symbol: string): PricePoint[] {
    return this.priceHistory[symbol] || [];
  }

  private getCloses(symbol: string): number[] {
    return (this.priceHistory[symbol] || []).map(p => p.close);
  }

  // ---- Indicators ----

  calculateIndicators(symbol: string): TechnicalIndicators {
    const points = this.priceHistory[symbol] || [];
    const closes = points.map(p => p.close);
    const volumes = points.map(p => p.volume);
    if (closes.length < 50) {
      const last = closes[closes.length - 1] || 0;
      return {
        ema9: last, ema21: last, ema50: last, ema200: last,
        rsi: 50, macd: 0, macdSignal: 0, macdHistogram: 0,
        atr: 0, bollingerUpper: last * 1.02, bollingerMiddle: last,
        bollingerLower: last * 0.98, volumeMA: 0, vwap: last, atrPercent: 0,
      };
    }
    const ema9Arr = calcEma(closes, 9);
    const ema21Arr = calcEma(closes, 21);
    const ema50Arr = calcEma(closes, 50);
    const ema200Arr = closes.length >= 200 ? calcEma(closes, 200) : calcEma(closes, closes.length);
    const rsiVal = calcRsi(closes, 14);
    const macdData = calcMacd(closes);
    const atrVal = calcAtr(points, 14);
    const bb = calcBollinger(closes, 20);
    const volMA = volumes.length >= 20 ? calcSma(volumes, 20) : [0];
    const vwapVal = points.reduce((s, p) => s + p.close * p.volume, 0) / (points.reduce((s, p) => s + p.volume, 0) || 1);
    const lastClose = closes[closes.length - 1];
    return {
      ema9: ema9Arr[ema9Arr.length - 1] || lastClose,
      ema21: ema21Arr[ema21Arr.length - 1] || lastClose,
      ema50: ema50Arr[ema50Arr.length - 1] || lastClose,
      ema200: ema200Arr[ema200Arr.length - 1] || lastClose,
      rsi: rsiVal, macd: macdData.macd, macdSignal: macdData.signal, macdHistogram: macdData.histogram,
      atr: atrVal, bollingerUpper: bb.upper, bollingerMiddle: bb.middle, bollingerLower: bb.lower,
      volumeMA: volMA[volMA.length - 1] || 0, vwap: vwapVal,
      atrPercent: lastClose > 0 ? (atrVal / lastClose) * 100 : 0,
    };
  }

  // ---- Regime Detection ----

  detectRegime(symbol: string): MarketRegime {
    const ind = this.calculateIndicators(symbol);
    const closes = this.getCloses(symbol);
    if (closes.length < 50) return "ranging";

    const up = ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50;
    const down = ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50;

    if (ind.atrPercent > 3) return "high_volatility";
    if (ind.atrPercent < 0.5) return "low_volatility";
    if (up && ind.rsi > 55) return "strong_uptrend";
    if (up) return "uptrend";
    if (down && ind.rsi < 45) return "strong_downtrend";
    if (down) return "downtrend";
    return "ranging";
  }

  // ---- Pattern Detection ----

  private detectPatterns(symbol: string): PatternMatch[] {
    const ind = this.calculateIndicators(symbol);
    const closes = this.getCloses(symbol);
    const points = this.priceHistory[symbol] || [];
    const patterns: PatternMatch[] = [];
    const gw = (n: string) => this.patternPerf[n]?.weight ?? 1.0;
    const ga = (n: string) => { const p = this.patternPerf[n]; return p && p.total > 0 ? p.accuracy : 0.5; };
    const gs = (n: string) => this.patternPerf[n]?.total ?? 0;

    if (ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50) {
      patterns.push({ pattern: "EMA Bullish Alignment", confidence: 0.72, expectedMove: "bullish", timeframe: "short", weight: gw("EMA Bullish Alignment"), historicalAccuracy: ga("EMA Bullish Alignment"), sampleSize: gs("EMA Bullish Alignment") });
    } else if (ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50) {
      patterns.push({ pattern: "EMA Bearish Alignment", confidence: 0.72, expectedMove: "bearish", timeframe: "short", weight: gw("EMA Bearish Alignment"), historicalAccuracy: ga("EMA Bearish Alignment"), sampleSize: gs("EMA Bearish Alignment") });
    }

    if (ind.macd > ind.macdSignal && ind.macdHistogram > 0) {
      patterns.push({ pattern: "MACD Bullish Cross", confidence: 0.65, expectedMove: "bullish", timeframe: "medium", weight: gw("MACD Bullish Cross"), historicalAccuracy: ga("MACD Bullish Cross"), sampleSize: gs("MACD Bullish Cross") });
    } else if (ind.macd < ind.macdSignal && ind.macdHistogram < 0) {
      patterns.push({ pattern: "MACD Bearish Cross", confidence: 0.65, expectedMove: "bearish", timeframe: "medium", weight: gw("MACD Bearish Cross"), historicalAccuracy: ga("MACD Bearish Cross"), sampleSize: gs("MACD Bearish Cross") });
    }

    if (ind.rsi > 70) {
      patterns.push({ pattern: "RSI Overbought", confidence: 0.58, expectedMove: "bearish", timeframe: "short", weight: gw("RSI Overbought"), historicalAccuracy: ga("RSI Overbought"), sampleSize: gs("RSI Overbought") });
    } else if (ind.rsi < 30) {
      patterns.push({ pattern: "RSI Oversold", confidence: 0.58, expectedMove: "bullish", timeframe: "short", weight: gw("RSI Oversold"), historicalAccuracy: ga("RSI Oversold"), sampleSize: gs("RSI Oversold") });
    } else if (ind.rsi > 50 && ind.rsi < 65) {
      patterns.push({ pattern: "RSI Bullish Zone", confidence: 0.52, expectedMove: "bullish", timeframe: "short", weight: gw("RSI Bullish Zone"), historicalAccuracy: ga("RSI Bullish Zone"), sampleSize: gs("RSI Bullish Zone") });
    }

    const bbRange = ind.bollingerUpper - ind.bollingerLower;
    if (bbRange > 0) {
      const pp = (closes[closes.length - 1] - ind.bollingerLower) / bbRange;
      if (pp > 0.9) patterns.push({ pattern: "Upper Bollinger Touch", confidence: 0.55, expectedMove: "bearish", timeframe: "short", weight: gw("Upper Bollinger Touch"), historicalAccuracy: ga("Upper Bollinger Touch"), sampleSize: gs("Upper Bollinger Touch") });
      else if (pp < 0.1) patterns.push({ pattern: "Lower Bollinger Touch", confidence: 0.55, expectedMove: "bullish", timeframe: "short", weight: gw("Lower Bollinger Touch"), historicalAccuracy: ga("Lower Bollinger Touch"), sampleSize: gs("Lower Bollinger Touch") });
    }

    if (ind.volumeMA > 0 && points.length > 0) {
      const cv = points[points.length - 1].volume;
      if (cv > ind.volumeMA * 1.5) {
        const dir = closes[closes.length - 1] > (closes[closes.length - 2] || closes[closes.length - 1]) ? "bullish" : "bearish";
        patterns.push({ pattern: "Volume Spike", confidence: 0.68, expectedMove: dir, timeframe: "immediate", weight: gw("Volume Spike"), historicalAccuracy: ga("Volume Spike"), sampleSize: gs("Volume Spike") });
      }
    }

    const lastClose = closes[closes.length - 1];
    if (lastClose > 0 && Math.abs(lastClose - ind.ema50) / lastClose < 0.02) {
      patterns.push({ pattern: "EMA50 S/R Test", confidence: 0.6, expectedMove: lastClose > ind.ema50 ? "bullish" : "bearish", timeframe: "medium", weight: gw("EMA50 S/R Test"), historicalAccuracy: ga("EMA50 S/R Test"), sampleSize: gs("EMA50 S/R Test") });
    }

    if (closes.length >= 5) {
      const mom = (closes[closes.length - 1] - closes[closes.length - 5]) / closes[closes.length - 5];
      if (Math.abs(mom) > 0.03) {
        const n = mom > 0 ? "Strong Positive Momentum" : "Strong Negative Momentum";
        patterns.push({ pattern: n, confidence: 0.67, expectedMove: mom > 0 ? "bullish" : "bearish", timeframe: "short", weight: gw(n), historicalAccuracy: ga(n), sampleSize: gs(n) });
      }
    }

    if (bbRange > 0 && closes.length >= 20) {
      const prevBB = calcBollinger(closes.slice(0, -1), 20);
      const sq = bbRange / (prevBB.upper - prevBB.lower || 1);
      if (sq < 0.5 && closes[closes.length - 1] > ind.bollingerUpper) {
        patterns.push({ pattern: "Bollinger Squeeze Breakout Up", confidence: 0.7, expectedMove: "bullish", timeframe: "medium", weight: gw("Bollinger Squeeze Breakout Up"), historicalAccuracy: ga("Bollinger Squeeze Breakout Up"), sampleSize: gs("Bollinger Squeeze Breakout Up") });
      } else if (sq < 0.5 && closes[closes.length - 1] < ind.bollingerLower) {
        patterns.push({ pattern: "Bollinger Squeeze Breakout Down", confidence: 0.7, expectedMove: "bearish", timeframe: "medium", weight: gw("Bollinger Squeeze Breakout Down"), historicalAccuracy: ga("Bollinger Squeeze Breakout Down"), sampleSize: gs("Bollinger Squeeze Breakout Down") });
      }
    }

    if (ind.vwap > 0 && lastClose > 0) {
      const vd = (lastClose - ind.vwap) / ind.vwap;
      if (Math.abs(vd) > 0.01) {
        const n = vd > 0 ? "Price Above VWAP" : "Price Below VWAP";
        patterns.push({ pattern: n, confidence: 0.55, expectedMove: vd > 0 ? "bullish" : "bearish", timeframe: "short", weight: gw(n), historicalAccuracy: ga(n), sampleSize: gs(n) });
      }
    }

    if (closes.length >= 50) {
      const n = lastClose > ind.ema200 ? "Above EMA200 (Macro Uptrend)" : "Below EMA200 (Macro Downtrend)";
      patterns.push({ pattern: n, confidence: 0.6, expectedMove: lastClose > ind.ema200 ? "bullish" : "bearish", timeframe: "long", weight: gw(n), historicalAccuracy: ga(n), sampleSize: gs(n) });
    }

    if (closes.length >= 5) {
      const last5 = closes.slice(-5);
      const allUp = last5.every((c, i) => i === 0 || c > last5[i - 1]);
      const allDown = last5.every((c, i) => i === 0 || c < last5[i - 1]);
      if (allUp) patterns.push({ pattern: "5 Consecutive Higher Closes", confidence: 0.6, expectedMove: "bullish", timeframe: "short", weight: gw("5 Consecutive Higher Closes"), historicalAccuracy: ga("5 Consecutive Higher Closes"), sampleSize: gs("5 Consecutive Higher Closes") });
      else if (allDown) patterns.push({ pattern: "5 Consecutive Lower Closes", confidence: 0.6, expectedMove: "bearish", timeframe: "short", weight: gw("5 Consecutive Lower Closes"), historicalAccuracy: ga("5 Consecutive Lower Closes"), sampleSize: gs("5 Consecutive Lower Closes") });
    }

    const regime = this.lastRegime;
    if (regime === "strong_uptrend" || regime === "uptrend") {
      patterns.push({ pattern: "Regime: Trending Up", confidence: 0.7, expectedMove: "bullish", timeframe: "medium", weight: gw("Regime: Trending Up"), historicalAccuracy: ga("Regime: Trending Up"), sampleSize: gs("Regime: Trending Up") });
    } else if (regime === "strong_downtrend" || regime === "downtrend") {
      patterns.push({ pattern: "Regime: Trending Down", confidence: 0.7, expectedMove: "bearish", timeframe: "medium", weight: gw("Regime: Trending Down"), historicalAccuracy: ga("Regime: Trending Down"), sampleSize: gs("Regime: Trending Down") });
    }

    return patterns;
  }

  // ---- Self-Discovery ----

  discoverPatterns(symbol: string): PatternMatch[] {
    const closes = this.getCloses(symbol);
    const points = this.priceHistory[symbol] || [];
    if (closes.length < 100) return [];
    const discovered: PatternMatch[] = [];
    const recent = closes.slice(-50);

    if (recent.length >= 10) {
      const moves: number[] = [];
      for (let i = 1; i < recent.length; i++) moves.push(recent[i] - recent[i - 1]);
      const avgRecent = moves.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const avgPrev = moves.slice(-15, -5).reduce((a, b) => a + b, 0) / 10;
      if (Math.abs(avgRecent) > Math.abs(avgPrev) * 1.5 && Math.abs(avgRecent) / recent[recent.length - 1] > 0.001) {
        if (!this.patternPerf["Price Acceleration"] || this.patternPerf["Price Acceleration"].total < 5) {
          this.metrics.discoveryCount++;
          discovered.push({ pattern: "Price Acceleration", confidence: 0.6, expectedMove: avgRecent > 0 ? "bullish" : "bearish", timeframe: "immediate", weight: 1.0, historicalAccuracy: 0.5, sampleSize: 0 });
        }
      }
    }

    if (points.length >= 20) {
      const rp = points.slice(-20);
      const pu = rp[rp.length - 1].close > rp[0].close;
      const vi = rp[rp.length - 1].volume > rp[0].volume * 1.5;
      if (pu && !vi && (!this.patternPerf["Bearish Volume Divergence"] || this.patternPerf["Bearish Volume Divergence"].total < 3)) {
        this.metrics.discoveryCount++;
        discovered.push({ pattern: "Bearish Volume Divergence", confidence: 0.55, expectedMove: "bearish", timeframe: "medium", weight: 1.0, historicalAccuracy: 0.5, sampleSize: 0 });
      } else if (!pu && vi && (!this.patternPerf["Bullish Volume Divergence"] || this.patternPerf["Bullish Volume Divergence"].total < 3)) {
        this.metrics.discoveryCount++;
        discovered.push({ pattern: "Bullish Volume Divergence", confidence: 0.55, expectedMove: "bullish", timeframe: "medium", weight: 1.0, historicalAccuracy: 0.5, sampleSize: 0 });
      }
    }

    return discovered;
  }

  // ---- Signal Generation ----

  analyzeMarket(symbol: string): TradingSignal {
    this.lastRegime = this.detectRegime(symbol);
    const basePatterns = this.detectPatterns(symbol);
    const discPatterns = this.discoverPatterns(symbol);
    const allPatterns = [...basePatterns, ...discPatterns];

    let bullScore = 0, bearScore = 0, totalWeight = 0;
    for (const p of allPatterns) {
      const w = p.weight * (p.sampleSize > 5 ? p.historicalAccuracy : 0.5);
      const adj = p.confidence * w;
      if (p.expectedMove === "bullish") bullScore += adj;
      else if (p.expectedMove === "bearish") bearScore += adj;
      totalWeight += p.weight;
    }

    const netScore = totalWeight > 0 ? (bullScore - bearScore) / totalWeight : 0;
    const rawConf = Math.abs(netScore) * 100;
    const ind = this.calculateIndicators(symbol);
    const lastClose = this.getCloses(symbol).slice(-1)[0] || 0;

    const rb = ((this.lastRegime === "strong_uptrend" || this.lastRegime === "uptrend") && netScore > 0 ? 1.2 :
               (this.lastRegime === "strong_downtrend" || this.lastRegime === "downtrend") && netScore < 0 ? 1.2 : 1.0);
    const eff = netScore * rb;

    let action: "buy" | "sell" | "hold";
    if (eff > 0.12 && ind.rsi < 72) action = "buy";
    else if (eff < -0.12 && ind.rsi > 28) action = "sell";
    else action = "hold";

    const stopDist = ind.atr * 2;
    const targetDist = ind.atr * 3.5;
    const stopLoss = action === "sell" ? lastClose + stopDist : lastClose - stopDist;
    const takeProfit = action === "sell" ? lastClose - targetDist : lastClose + targetDist;
    const riskReward = stopDist > 0 ? targetDist / stopDist : 1.5;
    const confidence = Math.min(rawConf, 95);

    const reasons: string[] = [];
    for (const p of allPatterns) {
      if (p.confidence > 0.5) reasons.push(`${p.pattern} (${(p.confidence * 100).toFixed(0)}%)`);
    }

    const signal: TradingSignal = {
      id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      symbol, timestamp: now(), action, confidence, entryPrice: lastClose,
      stopLoss, takeProfit, riskReward, reasons: reasons.slice(0, 5),
      patterns: allPatterns, indicators: ind,
      expectedDuration: allPatterns.some(p => p.timeframe === "immediate") ? "1-4 hours" :
                        allPatterns.some(p => p.timeframe === "short") ? "4-24 hours" : "1-7 days",
      aiConfidence: confidence, regime: this.lastRegime,
    };

    this.registerForEvaluation(signal);
    this.metrics.totalSignalsTracked++;
    this.metrics.signalsPending++;
    this.metrics.averageConfidence = confidence;
    this.metrics.lastUpdated = now();
    this.save();
    return signal;
  }

  // ---- Self-Evaluation ----

  private registerForEvaluation(signal: TradingSignal): void {
    const ev: PendingSignalEval = {
      signalId: signal.id, symbol: signal.symbol, signal,
      entryPrice: signal.entryPrice, entryTime: signal.timestamp,
      checkpoints: EVAL_CHECKPOINTS_MINUTES.map(min => ({
        targetTime: signal.timestamp + min * 60000, evaluated: false, priceAtTime: null, directionCorrect: null,
      })),
    };
    this.pendingEvals.push(ev);
    this.saveEvals();
  }

  evaluatePendingSignals(): void {
    const curNow = now();
    let changed = false;

    for (const ev of this.pendingEvals) {
      const history = this.priceHistory[ev.symbol] || [];
      for (const cp of ev.checkpoints) {
        if (cp.evaluated || curNow < cp.targetTime) continue;
        const closest = history.find(p => Math.abs(p.time - cp.targetTime) < 120000);
        if (!closest) continue;
        cp.priceAtTime = closest.close;
        const dir = ev.signal.action === "buy" ? 1 : ev.signal.action === "sell" ? -1 : 0;
        cp.directionCorrect = dir > 0 ? closest.close > ev.entryPrice : dir < 0 ? closest.close < ev.entryPrice : false;
        cp.evaluated = true;
        changed = true;
      }
    }

    if (changed) {
      this.processCompletedEvaluations();
      this.save();
      this.saveEvals();
    }
  }

  private processCompletedEvaluations(): void {
    const completed: PendingSignalEval[] = [];
    const still: PendingSignalEval[] = [];
    const curNow = now();

    for (const ev of this.pendingEvals) {
      const hasResults = ev.checkpoints.some(cp => cp.evaluated);
      const allDone = ev.checkpoints.every(cp => cp.evaluated || curNow < cp.targetTime);
      if (hasResults && allDone) completed.push(ev);
      else still.push(ev);
    }
    this.pendingEvals = still;
    for (const ev of completed) this.processSingleEvaluation(ev);
  }

  private processSingleEvaluation(ev: PendingSignalEval): void {
    const checked = ev.checkpoints.filter(cp => cp.evaluated);
    if (checked.length === 0) return;
    const latest = checked[checked.length - 1];
    const isWin = latest.directionCorrect === true;
    const pnlPct = latest.priceAtTime && ev.entryPrice > 0
      ? ((latest.priceAtTime - ev.entryPrice) / ev.entryPrice) * (ev.signal.action === "buy" ? 1 : -1) * 100
      : 0;

    this.metrics.totalPredictions++;
    this.metrics.signalsPending = Math.max(0, this.metrics.signalsPending - 1);

    if (isWin) {
      this.metrics.correctPredictions++;
      this.metrics.signalsWinning++;
      if (this.metrics.streakType === "win") this.metrics.currentStreak++;
      else { this.metrics.currentStreak = 1; this.metrics.streakType = "win"; }
    } else {
      this.metrics.signalsLosing++;
      if (this.metrics.streakType === "loss") this.metrics.currentStreak++;
      else { this.metrics.currentStreak = 1; this.metrics.streakType = "loss"; }
    }

    this.metrics.accuracy = this.metrics.totalPredictions > 0 ? this.metrics.correctPredictions / this.metrics.totalPredictions : 0;

    for (const p of ev.signal.patterns) {
      if (!this.patternPerf[p.pattern]) {
        this.patternPerf[p.pattern] = { pattern: p.pattern, total: 0, correct: 0, accuracy: 0.5, weight: 1.0, lastSeen: now(), recentAccuracy: 0.5, discoveredAt: now() };
      }
      const perf = this.patternPerf[p.pattern];
      perf.total++;
      perf.lastSeen = now();
      if (isWin) perf.correct++;
      const wv = isWin ? 1 : 0;
      perf.recentAccuracy = perf.recentAccuracy * DECAY_RATE + wv * (1 - DECAY_RATE);
      perf.accuracy = perf.total > 0 ? perf.correct / perf.total : 0.5;
      const oldW = perf.weight;
      if (perf.recentAccuracy > 0.65) perf.weight = Math.min(perf.weight + LEARNING_RATE, MAX_WEIGHT);
      else if (perf.recentAccuracy < 0.4) perf.weight = Math.max(perf.weight - LEARNING_RATE, MIN_WEIGHT);
      if (oldW !== perf.weight) this.metrics.selfAdjustments++;

      if (!this.metrics.patternAccuracy[p.pattern]) this.metrics.patternAccuracy[p.pattern] = { correct: 0, total: 0 };
      this.metrics.patternAccuracy[p.pattern].total++;
      if (isWin) this.metrics.patternAccuracy[p.pattern].correct++;
    }

    const regime = ev.signal.regime;
    const rd = this.metrics.regimeHistory[regime];
    if (rd) {
      rd.signals++;
      rd.accuracy = (rd.accuracy * (rd.signals - 1) + (isWin ? 1 : 0)) / rd.signals;
    }

    const sorted = Object.entries(this.patternPerf).filter(([, p]) => p.total >= 3).sort((a, b) => b[1].recentAccuracy - a[1].recentAccuracy);
    this.metrics.bestPerformingPatterns = sorted.slice(0, 5).map(([n]) => n);
    this.metrics.worstPerformingPatterns = sorted.slice(-5).map(([n]) => n);

    const wAcc = sorted.length > 0 ? sorted.reduce((s, [, p]) => s + p.recentAccuracy * Math.min(p.total / 10, 1), 0) / sorted.length : 0.5;
    this.metrics.evolutionScore = Math.round(Math.max(0, Math.min(100, (wAcc - 0.4) * 250)));
  }

  // ---- Manual Learning (for user-entered signals) ----

  learnFromOutcome(signal: TradingSignal, actualOutcome: "win" | "loss", _actualPnL: number): void {
    this.metrics.totalPredictions++;
    if (actualOutcome === "win") this.metrics.correctPredictions++;
    this.metrics.signalsPending = Math.max(0, this.metrics.signalsPending - 1);

    if (actualOutcome === "win") {
      this.metrics.signalsWinning++;
      if (this.metrics.streakType === "win") this.metrics.currentStreak++;
      else { this.metrics.currentStreak = 1; this.metrics.streakType = "win"; }
    } else {
      this.metrics.signalsLosing++;
      if (this.metrics.streakType === "loss") this.metrics.currentStreak++;
      else { this.metrics.currentStreak = 1; this.metrics.streakType = "loss"; }
    }

    this.metrics.accuracy = this.metrics.totalPredictions > 0 ? this.metrics.correctPredictions / this.metrics.totalPredictions : 0;

    for (const p of signal.patterns) {
      if (!this.patternPerf[p.pattern]) {
        this.patternPerf[p.pattern] = { pattern: p.pattern, total: 0, correct: 0, accuracy: 0.5, weight: 1.0, lastSeen: now(), recentAccuracy: 0.5, discoveredAt: now() };
      }
      const perf = this.patternPerf[p.pattern];
      perf.total++;
      perf.lastSeen = now();
      if (actualOutcome === "win") perf.correct++;
      const wv = actualOutcome === "win" ? 1 : 0;
      perf.recentAccuracy = perf.recentAccuracy * DECAY_RATE + wv * (1 - DECAY_RATE);
      perf.accuracy = perf.total > 0 ? perf.correct / perf.total : 0.5;
      const oldW = perf.weight;
      if (perf.recentAccuracy > 0.65) perf.weight = Math.min(perf.weight + LEARNING_RATE, MAX_WEIGHT);
      else if (perf.recentAccuracy < 0.4) perf.weight = Math.max(perf.weight - LEARNING_RATE, MIN_WEIGHT);
      if (oldW !== perf.weight) this.metrics.selfAdjustments++;
    }

    const sorted = Object.entries(this.patternPerf).filter(([, p]) => p.total >= 3).sort((a, b) => b[1].recentAccuracy - a[1].recentAccuracy);
    this.metrics.bestPerformingPatterns = sorted.slice(0, 5).map(([n]) => n);
    this.metrics.worstPerformingPatterns = sorted.slice(-5).map(([n]) => n);
    this.metrics.lastUpdated = now();
    this.save();
  }

  // ---- Weight Decay ----

  decayWeights(): void {
    const curNow = now();
    for (const [, perf] of Object.entries(this.patternPerf)) {
      if (curNow - perf.lastSeen > 7 * 24 * 60 * 60 * 1000) {
        perf.weight *= 0.95;
        if (perf.weight < MIN_WEIGHT) perf.weight = MIN_WEIGHT;
      }
      perf.recentAccuracy *= DECAY_RATE;
    }
    this.metrics.selfAdjustments++;
    this.save();
  }

  // ---- Persistence ----

  private save(): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ metrics: this.metrics, patternPerf: this.patternPerf }));
    const trimmed: Record<string, PricePoint[]> = {};
    for (const [sym, pts] of Object.entries(this.priceHistory)) trimmed[sym] = pts.slice(-500);
    localStorage.setItem(PRICE_HISTORY_KEY, JSON.stringify(trimmed));
  }

  private saveEvals(): void {
    if (typeof window === "undefined") return;
    const cutoff = now() - 48 * 60 * 60 * 1000;
    this.pendingEvals = this.pendingEvals.filter(e => e.entryTime > cutoff);
    localStorage.setItem(SIGNAL_EVAL_KEY, JSON.stringify(this.pendingEvals));
  }

  // ---- Public API ----

  getMetrics(): LearningMetrics { return { ...this.metrics }; }
  getPatternPerformance(): PatternPerformance[] { return Object.values(this.patternPerf).sort((a, b) => b.recentAccuracy - a.recentAccuracy); }
  getPatternWeights(): Record<string, number> { const w: Record<string, number> = {}; for (const [n, p] of Object.entries(this.patternPerf)) w[n] = p.weight; return w; }
  getRegime(): MarketRegime { return this.lastRegime; }

  reset(): void {
    this.metrics = this.defaultMetrics();
    this.patternPerf = {};
    this.pendingEvals = [];
    this.priceHistory = {};
    this.save();
    this.saveEvals();
    if (typeof window !== "undefined") localStorage.removeItem(PRICE_HISTORY_KEY);
  }
}

export const aiEngine = new AIEngine();
