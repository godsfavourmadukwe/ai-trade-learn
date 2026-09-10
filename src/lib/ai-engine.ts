// AI Trading Engine - Self-learning pattern recognition system

interface PriceData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TechnicalIndicators {
  ema9: number;
  ema21: number;
  ema50: number;
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
}

interface PatternMatch {
  pattern: string;
  confidence: number;
  expectedMove: "bullish" | "bearish" | "neutral";
  timeframe: string;
  historicalAccuracy: number;
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
}

// Simple EMA calculation
function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  
  // Start with SMA
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i];
  }
  ema.push(sum / period);
  
  // Calculate EMA
  for (let i = period; i < data.length; i++) {
    const value = (data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(value);
  }
  
  return ema;
}

// Simple RSI calculation
function calculateRSI(data: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  // Initial average
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < gains.length; i++) {
    if (i === period) {
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    } else {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }
  
  return rsi;
}

// Calculate MACD
function calculateMACD(data: number[]): { macd: number[]; signal: number[]; histogram: number[] } {
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  
  // Align arrays
  const offset = ema26.length - ema12.length;
  const macdLine: number[] = [];
  
  for (let i = 0; i < ema26.length; i++) {
    if (i >= offset) {
      macdLine.push(ema12[i - offset] - ema26[i]);
    }
  }
  
  const signalLine = calculateEMA(macdLine, 9);
  const histogram: number[] = [];
  
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + (macdLine.length - signalLine.length)] - signalLine[i]);
  }
  
  return { macd: macdLine, signal: signalLine, histogram };
}

// Calculate ATR
function calculateATR(data: PriceData[], period: number = 14): number[] {
  const atr: number[] = [];
  const trueRange: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const highLow = data[i].high - data[i].low;
    const highPrevClose = Math.abs(data[i].high - data[i - 1].close);
    const lowPrevClose = Math.abs(data[i].low - data[i - 1].close);
    trueRange.push(Math.max(highLow, highPrevClose, lowPrevClose));
  }
  
  // Initial ATR
  let atrValue = trueRange.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atr.push(atrValue);
  
  // Subsequent ATR values
  for (let i = period; i < trueRange.length; i++) {
    atrValue = (atrValue * (period - 1) + trueRange[i]) / period;
    atr.push(atrValue);
  }
  
  return atr;
}

// Calculate Bollinger Bands
function calculateBollingerBands(data: number[], period: number = 20, stdDev: number = 2) {
  const middle = calculateEMA(data, period);
  const upper: number[] = [];
  const lower: number[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    upper.push(mean + stdDev * std);
    lower.push(mean - stdDev * std);
  }
  
  return { upper, middle, lower };
}

// Pattern Recognition Engine
function detectPatterns(data: PriceData[], indicators: TechnicalIndicators): PatternMatch[] {
  const patterns: PatternMatch[] = [];
  const closes = data.map(d => d.close);
  const recent = closes.slice(-20);
  
  // 1. Trend Following Pattern
  if (indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50) {
    patterns.push({
      pattern: "Strong Uptrend",
      confidence: 0.75,
      expectedMove: "bullish",
      timeframe: "short",
      historicalAccuracy: 0.62,
    });
  } else if (indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50) {
    patterns.push({
      pattern: "Strong Downtrend",
      confidence: 0.75,
      expectedMove: "bearish",
      timeframe: "short",
      historicalAccuracy: 0.58,
    });
  }
  
  // 2. MACD Crossover
  if (indicators.macd > indicators.macdSignal && indicators.macdHistogram > 0) {
    patterns.push({
      pattern: "MACD Bullish Crossover",
      confidence: 0.65,
      expectedMove: "bullish",
      timeframe: "medium",
      historicalAccuracy: 0.55,
    });
  } else if (indicators.macd < indicators.macdSignal && indicators.macdHistogram < 0) {
    patterns.push({
      pattern: "MACD Bearish Crossover",
      confidence: 0.65,
      expectedMove: "bearish",
      timeframe: "medium",
      historicalAccuracy: 0.53,
    });
  }
  
  // 3. RSI Divergence/Extreme
  if (indicators.rsi > 70) {
    patterns.push({
      pattern: "RSI Overbought",
      confidence: 0.6,
      expectedMove: "bearish",
      timeframe: "short",
      historicalAccuracy: 0.48,
    });
  } else if (indicators.rsi < 30) {
    patterns.push({
      pattern: "RSI Oversold",
      confidence: 0.6,
      expectedMove: "bullish",
      timeframe: "short",
      historicalAccuracy: 0.52,
    });
  } else if (indicators.rsi > 50 && indicators.rsi < 70) {
    patterns.push({
      pattern: "RSI Bullish Zone",
      confidence: 0.55,
      expectedMove: "bullish",
      timeframe: "short",
      historicalAccuracy: 0.58,
    });
  }
  
  // 4. Bollinger Band Squeeze/Expansion
  const bbRange = indicators.bollingerUpper - indicators.bollingerLower;
  const bbMiddle = indicators.bollingerMiddle;
  const pricePosition = (closes[closes.length - 1] - indicators.bollingerLower) / (indicators.bollingerUpper - indicators.bollingerLower);
  
  if (pricePosition > 0.9) {
    patterns.push({
      pattern: "Upper Bollinger Touch",
      confidence: 0.6,
      expectedMove: "bearish",
      timeframe: "short",
      historicalAccuracy: 0.45,
    });
  } else if (pricePosition < 0.1) {
    patterns.push({
      pattern: "Lower Bollinger Touch",
      confidence: 0.6,
      expectedMove: "bullish",
      timeframe: "short",
      historicalAccuracy: 0.55,
    });
  }
  
  // 5. Volume Spike
  if (closes[closes.length - 1] > indicators.volumeMA * 1.5) {
    patterns.push({
      pattern: "High Volume Move",
      confidence: 0.7,
      expectedMove: closes[closes.length - 1] > closes[closes.length - 2] ? "bullish" : "bearish",
      timeframe: "immediate",
      historicalAccuracy: 0.6,
    });
  }
  
  // 6. Moving Average Support/Resistance
  const currentPrice = closes[closes.length - 1];
  if (Math.abs(currentPrice - indicators.ema50) / currentPrice < 0.02) {
    patterns.push({
      pattern: "EMA50 Support Test",
      confidence: 0.65,
      expectedMove: currentPrice > indicators.ema50 ? "bullish" : "bearish",
      timeframe: "medium",
      historicalAccuracy: 0.57,
    });
  }
  
  // 7. Price Momentum
  const momentum = (closes[closes.length - 1] - closes[closes.length - 5]) / closes[closes.length - 5];
  if (Math.abs(momentum) > 0.03) {
    patterns.push({
      pattern: momentum > 0 ? "Strong Positive Momentum" : "Strong Negative Momentum",
      confidence: 0.7,
      expectedMove: momentum > 0 ? "bullish" : "bearish",
      timeframe: "short",
      historicalAccuracy: 0.56,
    });
  }
  
  return patterns;
}

// Main AI Analysis Engine
export class AIEngine {
  private learningData: LearningMetrics;
  private patternWeights: Record<string, number>;
  
  constructor() {
    // Load saved learning data or initialize defaults
    const savedData = typeof window !== 'undefined' ? localStorage.getItem('tradslly_ai_learning') : null;
    
    if (savedData) {
      const parsed = JSON.parse(savedData);
      this.learningData = parsed.metrics;
      this.patternWeights = parsed.weights;
    } else {
      this.learningData = {
        totalPredictions: 0,
        correctPredictions: 0,
        accuracy: 0,
        patternAccuracy: {},
        bestPerformingPatterns: [],
        worstPerformingPatterns: [],
        averageConfidence: 50,
        lastUpdated: Date.now(),
      };
      
      this.patternWeights = {
        "Strong Uptrend": 1.0,
        "Strong Downtrend": 1.0,
        "MACD Bullish Crossover": 1.0,
        "MACD Bearish Crossover": 1.0,
        "RSI Overbought": 1.0,
        "RSI Oversold": 1.0,
        "RSI Bullish Zone": 1.0,
        "Upper Bollinger Touch": 1.0,
        "Lower Bollinger Touch": 1.0,
        "High Volume Move": 1.0,
        "EMA50 Support Test": 1.0,
        "Strong Positive Momentum": 1.0,
        "Strong Negative Momentum": 1.0,
      };
    }
  }
  
  // Calculate all technical indicators
  calculateIndicators(data: PriceData[]): TechnicalIndicators {
    const closes = data.map(d => d.close);
    const volumes = data.map(d => d.volume);
    
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const ema50 = calculateEMA(closes, 50);
    const rsi = calculateRSI(closes, 14);
    const { macd, signal, histogram } = calculateMACD(closes);
    const atr = calculateATR(data, 14);
    const bollinger = calculateBollingerBands(closes, 20, 2);
    const volumeMA = calculateEMA(volumes, 20);
    
    // Calculate VWAP
    const vwap = data.reduce((sum, d) => sum + (d.close * d.volume), 0) / 
                 data.reduce((sum, d) => sum + d.volume, 0);
    
    return {
      ema9: ema9[ema9.length - 1] || closes[closes.length - 1],
      ema21: ema21[ema21.length - 1] || closes[closes.length - 1],
      ema50: ema50[ema50.length - 1] || closes[closes.length - 1],
      rsi: rsi[rsi.length - 1] || 50,
      macd: macd[macd.length - 1] || 0,
      macdSignal: signal[signal.length - 1] || 0,
      macdHistogram: histogram[histogram.length - 1] || 0,
      atr: atr[atr.length - 1] || 0,
      bollingerUpper: bollinger.upper[bollinger.upper.length - 1] || closes[closes.length - 1] * 1.02,
      bollingerMiddle: bollinger.middle[bollinger.middle.length - 1] || closes[closes.length - 1],
      bollingerLower: bollinger.lower[bollinger.lower.length - 1] || closes[closes.length - 1] * 0.98,
      volumeMA: volumeMA[volumeMA.length - 1] || volumes[volumes.length - 1],
      vwap,
    };
  }
  
  // Generate trading signal
  analyzeMarket(symbol: string, data: PriceData[]): TradingSignal {
    const indicators = this.calculateIndicators(data);
    const patterns = detectPatterns(data, indicators);
    const currentPrice = data[data.length - 1].close;
    
    // Calculate weighted confidence
    let bullishScore = 0;
    let bearishScore = 0;
    let totalWeight = 0;
    
    patterns.forEach(pattern => {
      const weight = this.patternWeights[pattern.pattern] || 1.0;
      const adjustedConfidence = pattern.confidence * weight * pattern.historicalAccuracy;
      
      if (pattern.expectedMove === "bullish") {
        bullishScore += adjustedConfidence;
      } else if (pattern.expectedMove === "bearish") {
        bearishScore += adjustedConfidence;
      }
      totalWeight += weight;
    });
    
    // Normalize scores
    bullishScore = totalWeight > 0 ? bullishScore / totalWeight : 0;
    bearishScore = totalWeight > 0 ? bearishScore / totalWeight : 0;
    
    // Determine action
    const netScore = bullishScore - bearishScore;
    const confidence = Math.abs(netScore) * 100;
    
    let action: "buy" | "sell" | "hold";
    if (netScore > 0.15 && indicators.rsi < 70) {
      action = "buy";
    } else if (netScore < -0.15 && indicators.rsi > 30) {
      action = "sell";
    } else {
      action = "hold";
    }
    
    // Calculate stop loss and take profit based on ATR
    const atrMultiplier = 2;
    const stopDistance = indicators.atr * atrMultiplier;
    const targetDistance = indicators.atr * (atrMultiplier * 1.5);
    
    let stopLoss: number;
    let takeProfit: number;
    
    if (action === "buy") {
      stopLoss = currentPrice - stopDistance;
      takeProfit = currentPrice + targetDistance;
    } else if (action === "sell") {
      stopLoss = currentPrice + stopDistance;
      takeProfit = currentPrice - targetDistance;
    } else {
      stopLoss = currentPrice - stopDistance;
      takeProfit = currentPrice + targetDistance;
    }
    
    // Generate reasons
    const reasons: string[] = [];
    patterns.forEach(p => {
      if (p.confidence > 0.5) {
        reasons.push(`${p.pattern} (${(p.confidence * 100).toFixed(0)}% confidence)`);
      }
    });
    
    // Determine expected duration based on timeframe
    const timeframes = patterns.map(p => p.timeframe);
    const expectedDuration = timeframes.includes("immediate") ? "1-4 hours" :
                            timeframes.includes("short") ? "4-24 hours" :
                            timeframes.includes("medium") ? "1-7 days" : "1-4 weeks";
    
    return {
      id: `signal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol,
      timestamp: Date.now(),
      action,
      confidence: Math.min(confidence, 95),
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      riskReward: Math.abs(takeProfit - currentPrice) / Math.abs(currentPrice - stopLoss),
      reasons,
      patterns,
      indicators,
      expectedDuration,
      aiConfidence: Math.min(confidence, 95),
    };
  }
  
  // Learn from trade outcome
  learnFromOutcome(signal: TradingSignal, actualOutcome: "win" | "loss", actualPnL: number): void {
    this.learningData.totalPredictions++;
    
    if (actualOutcome === "win") {
      this.learningData.correctPredictions++;
    }
    
    // Update pattern accuracy
    signal.patterns.forEach(pattern => {
      if (!this.learningData.patternAccuracy[pattern.pattern]) {
        this.learningData.patternAccuracy[pattern.pattern] = { correct: 0, total: 0 };
      }
      
      this.learningData.patternAccuracy[pattern.pattern].total++;
      
      if (actualOutcome === "win" && pattern.expectedMove === (actualPnL > 0 ? "bullish" : "bearish")) {
        this.learningData.patternAccuracy[pattern.pattern].correct++;
      }
    });
    
    // Update pattern weights based on performance
    Object.keys(this.learningData.patternAccuracy).forEach(pattern => {
      const accuracy = this.learningData.patternAccuracy[pattern];
      const successRate = accuracy.total > 0 ? accuracy.correct / accuracy.total : 0.5;
      
      // Adjust weight: increase if performing well, decrease if performing poorly
      if (successRate > 0.6) {
        this.patternWeights[pattern] = Math.min(this.patternWeights[pattern] * 1.1, 2.0);
      } else if (successRate < 0.4) {
        this.patternWeights[pattern] = Math.max(this.patternWeights[pattern] * 0.9, 0.5);
      }
    });
    
    // Update overall accuracy
    this.learningData.accuracy = this.learningData.correctPredictions / this.learningData.totalPredictions;
    this.learningData.averageConfidence = signal.aiConfidence;
    
    // Find best and worst performing patterns
    const patternPerformance = Object.entries(this.learningData.patternAccuracy)
      .map(([pattern, data]) => ({
        pattern,
        successRate: data.total > 0 ? data.correct / data.total : 0.5,
      }))
      .sort((a, b) => b.successRate - a.successRate);
    
    this.learningData.bestPerformingPatterns = patternPerformance.slice(0, 3).map(p => p.pattern);
    this.learningData.worstPerformingPatterns = patternPerformance.slice(-3).map(p => p.pattern);
    this.learningData.lastUpdated = Date.now();
    
    // Save to localStorage
    this.save();
  }
  
  // Save learning data
  save(): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('tradslly_ai_learning', JSON.stringify({
        metrics: this.learningData,
        weights: this.patternWeights,
      }));
    }
  }
  
  // Get learning metrics
  getMetrics(): LearningMetrics {
    return { ...this.learningData };
  }
  
  // Get pattern weights for display
  getPatternWeights(): Record<string, number> {
    return { ...this.patternWeights };
  }
  
  // Reset learning (for testing)
  reset(): void {
    this.learningData = {
      totalPredictions: 0,
      correctPredictions: 0,
      accuracy: 0,
      patternAccuracy: {},
      bestPerformingPatterns: [],
      worstPerformingPatterns: [],
      averageConfidence: 50,
      lastUpdated: Date.now(),
    };
    
    Object.keys(this.patternWeights).forEach(key => {
      this.patternWeights[key] = 1.0;
    });
    
    this.save();
  }
}

// Singleton instance
export const aiEngine = new AIEngine();
