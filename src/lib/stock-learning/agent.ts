// ============================================================
// STOCK MARKET LEARNING — Blind Training Agent
//
// The training agent operates in complete memory isolation:
//   Historical Market → Blind Agent → Decision → Reveal Future →
//   Score → Learning System
//
// The agent NEVER sees future candles before making its decision.
// After an episode, results flow ONE-WAY into the knowledge base.
//
// This implements the memory isolation architecture:
//   Historical Market → Blind Trader Agent → Decision →
//   Reveal Future → Score → Learning System
// ============================================================

import type {
  TrainingEpisode,
  BlindDecision,
  EpisodeResult,
  EpisodeTrade,
  EpisodeCheckpoint,
} from "./types";
import type { Candle, Interval } from "@/lib/market/types";
import type { TradeSide, MarketRegime } from "@/lib/arena/types";

// ── Feature Extraction (at decision time, NO future data) ─

interface DecisionFeatures {
  // Price structure
  price: number;
  ema10: number;
  ema20: number;
  ema50: number;
  sma200: number;
  priceVsSma200: number;

  // Momentum
  rsi14: number;
  roc5: number;
  roc10: number;
  roc20: number;

  // Volatility
  atr14: number;
  atrPercent: number;
  bbWidth: number;
  bbPosition: number;

  // Volume
  volumeRatio: number;
  obvTrend: number;

  // Trend
  adx14: number;
  trendStrength: number;
  higherHighs: boolean;
  higherLows: boolean;

  // Pattern
  candleBodyPercent: number;
  consecutiveUp: number;
  consecutiveDown: number;
}

// ── Blind Agent ───────────────────────────────────────────

export class BlindTrainingAgent {
  private agentId: string;
  private knowledgeVersion: string;

  constructor(agentId: string, knowledgeVersion: string = "v1.0") {
    this.agentId = agentId;
    this.knowledgeVersion = knowledgeVersion;
  }

  /**
   * Make a blind decision given ONLY the candles visible up to the
   * current point in time. NO FUTURE DATA is ever passed to this method.
   */
  makeDecision(
    visibleCandles: Candle[],
    currentEquity: number,
    openPosition: { side: TradeSide; entryPrice: number; entryTime: number; stopLoss: number; takeProfit: number; positionSize: number } | null,
  ): BlindDecision {
    const now = visibleCandles.length > 0 ? visibleCandles[visibleCandles.length - 1].time : Date.now();
    const price = visibleCandles.length > 0 ? visibleCandles[visibleCandles.length - 1].close : 0;

    // If we have an open position, check for exit
    if (openPosition) {
      return this.makeExitDecision(visibleCandles, openPosition, currentEquity);
    }

    // Extract features from visible candles only
    const features = this.extractFeatures(visibleCandles);

    // Run the decision logic
    const { action, confidence, reasoning } = this.evaluateEntry(features, visibleCandles);

    // Compute entry/exit levels
    let entryPrice: number | null = null;
    let stopLoss: number | null = null;
    let takeProfit: number | null = null;
    let positionSize: number | null = null;

    if (action === "BUY" || action === "SELL") {
      entryPrice = price;
      const atr = features.atr14 > 0 ? features.atr14 : price * 0.02;
      const side: TradeSide = action === "BUY" ? "long" : "short";

      if (side === "long") {
        stopLoss = price - atr * 2;
        takeProfit = price + atr * 4;
      } else {
        stopLoss = price + atr * 2;
        takeProfit = price - atr * 4;
      }

      // Position sizing: risk 0.5% of equity
      const riskPerUnit = Math.abs(price - stopLoss);
      if (riskPerUnit > 0) {
        const riskAmount = currentEquity * 0.005;
        positionSize = riskAmount / riskPerUnit;
      }
    }

    const estimatedProbability = this.estimateProbability(features, action);

    return {
      timestamp: now,
      price,
      visibleCandles: [...visibleCandles], // snapshot, not reference
      action,
      entryPrice,
      stopLoss,
      takeProfit,
      positionSize,
      reasoning,
      confidence,
      estimatedProbability,
      features: this.featuresToRecord(features),
    };
  }

  /**
   * Make an exit decision when a position is open.
   */
  private makeExitDecision(
    candles: Candle[],
    position: { side: TradeSide; entryPrice: number; entryTime: number; stopLoss: number; takeProfit: number; positionSize: number },
    currentEquity: number,
  ): BlindDecision {
    const current = candles[candles.length - 1];
    const price = current.close;
    const high = current.high;
    const low = current.low;

    let action: "BUY" | "SELL" | "HOLD" = "HOLD";
    let reasoning = "Holding position.";

    // Check stop loss and take profit
    if (position.side === "long") {
      if (low <= position.stopLoss) {
        action = "SELL";
        reasoning = `Stop loss hit at ${position.stopLoss.toFixed(2)}.`;
      } else if (high >= position.takeProfit) {
        action = "SELL";
        reasoning = `Take profit hit at ${position.takeProfit.toFixed(2)}.`;
      } else {
        // Time-based exit: 20 bars
        const barsHeld = candles.filter((c) => c.time >= position.entryTime).length;
        if (barsHeld >= 20) {
          action = "SELL";
          reasoning = `Time exit after ${barsHeld} bars.`;
        } else {
          reasoning = `Holding long. Entry: ${position.entryPrice.toFixed(2)}, Current: ${price.toFixed(2)}.`;
        }
      }
    } else {
      if (high >= position.stopLoss) {
        action = "BUY";
        reasoning = `Stop loss hit at ${position.stopLoss.toFixed(2)}.`;
      } else if (low <= position.takeProfit) {
        action = "BUY";
        reasoning = `Take profit hit at ${position.takeProfit.toFixed(2)}.`;
      } else {
        const barsHeld = candles.filter((c) => c.time >= position.entryTime).length;
        if (barsHeld >= 20) {
          action = "BUY";
          reasoning = `Time exit after ${barsHeld} bars.`;
        } else {
          reasoning = `Holding short. Entry: ${position.entryPrice.toFixed(2)}, Current: ${price.toFixed(2)}.`;
        }
      }
    }

    return {
      timestamp: current.time,
      price,
      visibleCandles: [...candles],
      action,
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      positionSize: null,
      reasoning,
      confidence: 0.9,
      estimatedProbability: 0.5,
      features: {},
    };
  }

  // ── Feature Extraction (NO future data) ─────────────────

  private extractFeatures(candles: Candle[]): DecisionFeatures {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);
    const price = closes[closes.length - 1] ?? 0;

    return {
      price,
      ema10: this.computeEMA(closes, 10),
      ema20: this.computeEMA(closes, 20),
      ema50: this.computeEMA(closes, 50),
      sma200: this.computeSMA(closes, Math.min(200, closes.length)),
      priceVsSma200: this.computeSMA(closes, Math.min(200, closes.length)) > 0
        ? (price / this.computeSMA(closes, Math.min(200, closes.length)) - 1)
        : 0,
      rsi14: this.computeRSI(closes, 14),
      roc5: this.computeROC(closes, 5),
      roc10: this.computeROC(closes, 10),
      roc20: this.computeROC(closes, 20),
      atr14: this.computeATR(highs, lows, closes, 14),
      atrPercent: this.computeATR(highs, lows, closes, 14) / price,
      bbWidth: this.computeBBWidth(closes, 20),
      bbPosition: this.computeBBPosition(closes, 20),
      volumeRatio: this.computeVolumeRatio(volumes, 20),
      obvTrend: this.computeOBVTrend(closes, volumes, 20),
      adx14: this.computeADX(highs, lows, closes, 14),
      trendStrength: this.computeTrendStrength(closes),
      higherHighs: this.checkHigherHighs(highs, 5),
      higherLows: this.checkHigherLows(lows, 5),
      candleBodyPercent: this.computeCandleBodyPercent(candles),
      consecutiveUp: this.countConsecutiveDirection(closes, "up"),
      consecutiveDown: this.countConsecutiveDirection(closes, "down"),
    };
  }

  // ── Decision Logic ──────────────────────────────────────

  private evaluateEntry(
    f: DecisionFeatures,
    candles: Candle[],
  ): { action: "BUY" | "SELL" | "HOLD"; confidence: number; reasoning: string } {
    let bullScore = 0;
    let bearScore = 0;
    const reasons: string[] = [];

    // EMA alignment
    if (f.ema10 > f.ema20 && f.ema20 > f.ema50) {
      bullScore += 2;
      reasons.push("Bullish EMA alignment");
    } else if (f.ema10 < f.ema20 && f.ema20 < f.ema50) {
      bearScore += 2;
      reasons.push("Bearish EMA alignment");
    }

    // Price vs SMA200
    if (f.priceVsSma200 > 0.02) {
      bullScore += 1;
      reasons.push("Price above SMA200");
    } else if (f.priceVsSma200 < -0.02) {
      bearScore += 1;
      reasons.push("Price below SMA200");
    }

    // RSI
    if (f.rsi14 > 50 && f.rsi14 < 70) {
      bullScore += 1;
      reasons.push(`RSI bullish at ${f.rsi14.toFixed(0)}`);
    } else if (f.rsi14 < 50 && f.rsi14 > 30) {
      bearScore += 1;
      reasons.push(`RSI bearish at ${f.rsi14.toFixed(0)}`);
    }

    // Momentum (ROC)
    if (f.roc5 > 0.01) {
      bullScore += 1;
      reasons.push("Positive 5-period ROC");
    } else if (f.roc5 < -0.01) {
      bearScore += 1;
      reasons.push("Negative 5-period ROC");
    }

    // ADX trend strength
    if (f.adx14 > 25) {
      if (f.trendStrength > 0) {
        bullScore += 1;
        reasons.push("Strong uptrend (ADX > 25)");
      } else {
        bearScore += 1;
        reasons.push("Strong downtrend (ADX > 25)");
      }
    }

    // Volume confirmation
    if (f.volumeRatio > 1.5) {
      // Volume confirms the direction
      if (f.roc5 > 0) bullScore += 1;
      else bearScore += 1;
      reasons.push("Volume confirms direction");
    }

    // Higher highs/lows
    if (f.higherHighs && f.higherLows) {
      bullScore += 1;
      reasons.push("Higher highs and lows");
    } else if (!f.higherHighs && !f.higherLows) {
      bearScore += 1;
      reasons.push("Lower highs and lows");
    }

    // Bollinger Band position
    if (f.bbPosition > 0.8) {
      bearScore += 0.5;
      reasons.push("Near upper BB (potential resistance)");
    } else if (f.bbPosition < 0.2) {
      bullScore += 0.5;
      reasons.push("Near lower BB (potential support)");
    }

    const totalScore = bullScore + bearScore;
    const netScore = bullScore - bearScore;

    // Decision threshold
    const BULL_THRESHOLD = 3;
    const BEAR_THRESHOLD = -3;

    if (netScore >= BULL_THRESHOLD) {
      return {
        action: "BUY",
        confidence: Math.min(1, Math.abs(netScore) / 6),
        reasoning: reasons.join(". ") + ". Bullish setup identified.",
      };
    } else if (netScore <= BEAR_THRESHOLD) {
      return {
        action: "SELL",
        confidence: Math.min(1, Math.abs(netScore) / 6),
        reasoning: reasons.join(". ") + ". Bearish setup identified.",
      };
    }

    return {
      action: "HOLD",
      confidence: totalScore > 0 ? 1 - Math.abs(netScore) / totalScore : 0.5,
      reasoning: reasons.length > 0
        ? reasons.join(". ") + ". No clear directional edge."
        : "Insufficient signals for entry.",
    };
  }

  // ── Probability Estimation ──────────────────────────────

  private estimateProbability(
    f: DecisionFeatures,
    action: "BUY" | "SELL" | "HOLD",
  ): number {
    if (action === "HOLD") return 0.5;

    let prob = 0.5;
    const side = action === "BUY" ? 1 : -1;

    // Trend alignment bonus
    const trendAligned = (side > 0 && f.ema10 > f.ema50) || (side < 0 && f.ema10 < f.ema50);
    if (trendAligned) prob += 0.08;

    // RSI in favorable zone
    const rsiFavorable = (side > 0 && f.rsi14 > 45 && f.rsi14 < 70) ||
      (side < 0 && f.rsi14 < 55 && f.rsi14 > 30);
    if (rsiFavorable) prob += 0.05;

    // Volume confirmation
    if (f.volumeRatio > 1.2) prob += 0.05;

    // ADX strength
    if (f.adx14 > 25) prob += 0.05;

    // Penalize extreme conditions
    if (f.rsi14 > 80 || f.rsi14 < 20) prob -= 0.1;
    if (f.atrPercent > 0.05) prob -= 0.05;

    return Math.max(0.3, Math.min(0.85, prob));
  }

  // ── Indicator Computations (all from visible data only) ─

  private computeEMA(data: number[], period: number): number {
    if (data.length < period) return data.length > 0 ? data[data.length - 1] : 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private computeSMA(data: number[], period: number): number {
    if (data.length < period) return data.length > 0 ? data.reduce((a, b) => a + b, 0) / data.length : 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  private computeRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    if (losses === 0) return 100;
    return 100 - 100 / (1 + gains / losses);
  }

  private computeROC(closes: number[], period: number): number {
    if (closes.length <= period) return 0;
    return (closes[closes.length - 1] - closes[closes.length - 1 - period]) / closes[closes.length - 1 - period];
  }

  private computeATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 0;
    const trs: number[] = [];
    for (let i = 1; i < highs.length; i++) {
      trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    if (trs.length < period) return 0;
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
  }

  private computeBBWidth(closes: number[], period: number): number {
    if (closes.length < period) return 0;
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, x) => s + (x - sma) ** 2, 0) / period;
    return (2 * Math.sqrt(variance)) / sma;
  }

  private computeBBPosition(closes: number[], period: number): number {
    if (closes.length < period) return 0.5;
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, x) => s + (x - sma) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    if (std === 0) return 0.5;
    const price = closes[closes.length - 1];
    return (price - (sma - 2 * std)) / (4 * std);
  }

  private computeVolumeRatio(volumes: number[], period: number): number {
    if (volumes.length < period + 1) return 1;
    const recent = volumes[volumes.length - 1];
    const avg = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
    return avg > 0 ? recent / avg : 1;
  }

  private computeOBVTrend(closes: number[], volumes: number[], period: number): number {
    if (closes.length < period) return 0;
    let obv = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) obv += volumes[i];
      else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    }
    return obv;
  }

  private computeADX(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 0;
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];
    const trs: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
      trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }

    if (trs.length < period) return 0;

    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let plusDI = plusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let minusDI = minusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;

    const dxs: number[] = [];

    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
      plusDI = (plusDI * (period - 1) + plusDMs[i]) / period;
      minusDI = (minusDI * (period - 1) + minusDMs[i]) / period;

      if (atr > 0) {
        const pDI = (plusDI / atr) * 100;
        const mDI = (minusDI / atr) * 100;
        const diSum = pDI + mDI;
        dxs.push(diSum > 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0);
      }
    }

    if (dxs.length < period) return dxs.length > 0 ? dxs.reduce((a, b) => a + b, 0) / dxs.length : 0;
    let adx = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dxs.length; i++) {
      adx = (adx * (period - 1) + dxs[i]) / period;
    }
    return adx;
  }

  private computeTrendStrength(closes: number[]): number {
    if (closes.length < 20) return 0;
    let upBars = 0;
    for (let i = closes.length - 20; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) upBars++;
    }
    return (upBars / 10) - 1; // -1 to +1
  }

  private checkHigherHighs(highs: number[], period: number): boolean {
    if (highs.length < period * 2) return false;
    const recent = highs.slice(-period);
    const previous = highs.slice(-period * 2, -period);
    return Math.max(...recent) > Math.max(...previous);
  }

  private checkHigherLows(lows: number[], period: number): boolean {
    if (lows.length < period * 2) return false;
    const recent = lows.slice(-period);
    const previous = lows.slice(-period * 2, -period);
    return Math.min(...recent) > Math.min(...previous);
  }

  private computeCandleBodyPercent(candles: Candle[]): number {
    if (candles.length === 0) return 0;
    const c = candles[candles.length - 1];
    return Math.abs(c.close - c.open) / c.open;
  }

  private countConsecutiveDirection(closes: number[], direction: "up" | "down"): number {
    let count = 0;
    for (let i = closes.length - 1; i > 0; i--) {
      if (direction === "up" && closes[i] > closes[i - 1]) count++;
      else if (direction === "down" && closes[i] < closes[i - 1]) count++;
      else break;
    }
    return count;
  }

  private featuresToRecord(f: DecisionFeatures): Record<string, number> {
    return {
      price: f.price,
      ema10: f.ema10,
      ema20: f.ema20,
      ema50: f.ema50,
      sma200: f.sma200,
      rsi14: f.rsi14,
      roc5: f.roc5,
      roc10: f.roc10,
      roc20: f.roc20,
      atr14: f.atr14,
      atrPercent: f.atrPercent,
      bbWidth: f.bbWidth,
      bbPosition: f.bbPosition,
      volumeRatio: f.volumeRatio,
      adx14: f.adx14,
      trendStrength: f.trendStrength,
    };
  }
}

// ── Episode Runner ────────────────────────────────────────

/**
 * Run a single blind training episode. The agent processes candles
 * one-by-one, making decisions with ONLY the data available at
 * that point in time.
 */
export function runBlindEpisode(
  agent: BlindTrainingAgent,
  candles: Candle[],
  initialEquity: number = 10_000,
  onProgress?: (index: number, total: number) => void,
): EpisodeResult {
  const decisions: BlindDecision[] = [];
  const trades: EpisodeTrade[] = [];
  let equity = initialEquity;
  let openPosition: {
    side: TradeSide;
    entryPrice: number;
    entryTime: number;
    stopLoss: number;
    takeProfit: number;
    positionSize: number;
  } | null = null;

  const MIN_CANDLES = 60; // Need at least 60 candles for feature extraction
  const equityCurve: number[] = [initialEquity];
  const regimePerformance: Record<string, { trades: number; pnl: number; winRate: number }> = {};

  for (let i = MIN_CANDLES; i < candles.length; i++) {
    // CRITICAL: Agent only sees candles[0..i], NEVER candles[i+1..]
    const visibleCandles = candles.slice(0, i + 1);
    const current = candles[i];

    // Make a blind decision
    const decision = agent.makeDecision(visibleCandles, equity, openPosition);
    decisions.push(decision);

    // Process the decision
    if (decision.action === "BUY" && decision.entryPrice && decision.stopLoss && decision.takeProfit && decision.positionSize && !openPosition) {
      // Open long position
      openPosition = {
        side: "long",
        entryPrice: decision.entryPrice,
        entryTime: current.time,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        positionSize: decision.positionSize,
      };
    } else if (decision.action === "SELL" && openPosition) {
      // Close position
      const exitPrice = decision.price;
      const priceDiff = openPosition.side === "long"
        ? exitPrice - openPosition.entryPrice
        : openPosition.entryPrice - exitPrice;
      const grossPnl = priceDiff * openPosition.positionSize;
      const fees = openPosition.positionSize * openPosition.entryPrice * 0.001; // 0.1% round trip
      const netPnl = grossPnl - fees;
      equity += netPnl;

      const holdingBars = candles.filter((c) => c.time >= openPosition!.entryTime && c.time <= current.time).length;

      let exitReason: EpisodeTrade["exitReason"] = "signal_exit";
      if (openPosition.side === "long" && current.low <= openPosition.stopLoss) exitReason = "stop_loss";
      else if (openPosition.side === "long" && current.high >= openPosition.takeProfit) exitReason = "take_profit";
      else if (openPosition.side === "short" && current.high >= openPosition.stopLoss) exitReason = "stop_loss";
      else if (openPosition.side === "short" && current.low <= openPosition.takeProfit) exitReason = "take_profit";

      trades.push({
        entryTime: openPosition.entryTime,
        exitTime: current.time,
        entryPrice: openPosition.entryPrice,
        exitPrice,
        side: openPosition.side,
        pnl: netPnl,
        pnlPercent: netPnl / (openPosition.entryPrice * openPosition.positionSize),
        fees,
        holdingBars,
        exitReason,
        regime: "unknown", // Will be computed externally
        decisionIndex: decisions.length - 1,
      });

      openPosition = null;
    }

    equityCurve.push(equity);
    onProgress?.(i, candles.length);
  }

  // Close any remaining position at the last candle
  if (openPosition) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close;
    const priceDiff = openPosition.side === "long"
      ? exitPrice - openPosition.entryPrice
      : openPosition.entryPrice - exitPrice;
    const grossPnl = priceDiff * openPosition.positionSize;
    const fees = openPosition.positionSize * openPosition.entryPrice * 0.001;
    const netPnl = grossPnl - fees;
    equity += netPnl;

    trades.push({
      entryTime: openPosition.entryTime,
      exitTime: lastCandle.time,
      entryPrice: openPosition.entryPrice,
      exitPrice,
      side: openPosition.side,
      pnl: netPnl,
      pnlPercent: netPnl / (openPosition.entryPrice * openPosition.positionSize),
      fees,
      holdingBars: 20,
      exitReason: "time_exit",
      regime: "unknown",
      decisionIndex: decisions.length - 1,
    });

    equityCurve.push(equity);
  }

  // Compute performance metrics
  const winningTrades = trades.filter((t) => t.pnl > 0);
  const losingTrades = trades.filter((t) => t.pnl <= 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgWin = winningTrades.length > 0 ? winningTrades.reduce((s, t) => s + t.pnl, 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? losingTrades.reduce((s, t) => s + t.pnl, 0) / losingTrades.length : 0;

  // Max drawdown
  let peak = initialEquity;
  let maxDd = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  // Sharpe-like ratio
  const returns = equityCurve.slice(1).map((eq, i) => (eq - equityCurve[i]) / equityCurve[i]);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const returnStd = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  const sharpe = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0;

  // Max consecutive losses
  let maxConsecLoss = 0;
  let currentConsecLoss = 0;
  for (const t of trades) {
    if (t.pnl <= 0) {
      currentConsecLoss++;
      maxConsecLoss = Math.max(maxConsecLoss, currentConsecLoss);
    } else {
      currentConsecLoss = 0;
    }
  }

  // Profit factor
  const grossWins = winningTrades.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? winningTrades.length / trades.length : 0,
    totalReturn: (equity - initialEquity) / initialEquity,
    sharpeRatio: sharpe,
    sortinoRatio: sharpe, // Simplified
    profitFactor,
    expectancy: trades.length > 0 ? totalPnl / trades.length : 0,
    maxDrawdown: maxDd,
    maxConsecutiveLosses: maxConsecLoss,
    avgWin: avgWin,
    avgLoss: avgLoss,
    avgRiskReward: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0,
    totalFees: trades.reduce((s, t) => s + t.fees, 0),
    trades,
    equityCurve,
    decisions,
    regimePerformance: regimePerformance as Record<MarketRegime, { trades: number; pnl: number; winRate: number }>,
  };
}
