// ============================================================
// AI TRADE ARENA — Core Engine
//
// Event-driven pipeline:
//   live tick/candle → feature extraction → regime detection →
//   signal candidate → risk gate → demo execution → trade mgmt
//
// Default decision is ALWAYS NO TRADE.
// A trade is created only when all quantitative gates pass.
// ============================================================

import { marketEngine, type EngineSnapshot } from "@/lib/market/engine";
import { PAIRS } from "@/lib/market/symbols";
import type { Candle, Interval, TickEvent } from "@/lib/market/types";
import {
  checkReadiness,
  computeDataHealth,
  type ReadinessContext,
} from "./conditions";
import { decisionFusionEngine } from "./fusion";
import { decisionLogger } from "./decision-logger";
import type { ModuleInput } from "./modules";
import type {
  ArenaDataHealth,
  ArenaInstrument,
  ArenaSignal,
  ArenaSignalEvidence,
  ArenaTimeframe,
  ArenaTrade,
  ArenaTradeStatus,
  MarketRegime,
  TradeSide,
  ArenaPerformanceSummary,
} from "./types";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface ArenaEngineConfig {
  initialCapital: number;
  riskPerTrade: number; // 0.005 = 0.5%
  maxSimultaneousPositions: number;
  minConfidence: number; // 0-1, minimum model probability to trade
  minExpectedValue: number; // minimum EV after fees
  minRiskReward: number; // minimum R:R ratio
  maxSpreadBps: number; // max spread in bps
  minVolume24hQuote: number; // min 24h volume
  longsEnabled: boolean;
  shortsEnabled: boolean;
  maxModelUncertainty: number;
  feesBps: number; // trading fees in bps (both sides)
  slippageBps: number; // estimated slippage in bps
}

const DEFAULT_CONFIG: ArenaEngineConfig = {
  initialCapital: 10_000,
  riskPerTrade: 0.005,
  maxSimultaneousPositions: 1,
  minConfidence: 0.55,
  minExpectedValue: 0,
  minRiskReward: 1.5,
  maxSpreadBps: 50,
  minVolume24hQuote: 50_000_000,
  longsEnabled: true,
  shortsEnabled: false,
  maxModelUncertainty: 0.35,
  feesBps: 10, // 0.1% round trip
  slippageBps: 5,
};

export interface ArenaSnapshot {
  trades: ArenaTrade[];
  signals: ArenaSignal[];
  performance: ArenaPerformanceSummary;
  status: ArenaStatusInfo;
}

export interface ArenaStatusInfo {
  enabled: boolean;
  modelVersion: string;
  paused: boolean;
  dataHealth: ArenaDataHealth;
  lastDecisionTime: number | null;
  decisionsToday: number;
  openPositions: number;
  capital: number;
}

type ArenaEventListener = (snapshot: ArenaSnapshot) => void;

// ────────────────────────────────────────────────────────────
// Simple online statistics for adaptive learning
// ────────────────────────────────────────────────────────────

interface RunningStats {
  n: number;
  mean: number;
  m2: number;
  min: number;
  max: number;
}

function updateRunningStats(s: RunningStats, x: number): RunningStats {
  s.n++;
  const delta = x - s.mean;
  s.mean += delta / s.n;
  const delta2 = x - s.mean;
  s.m2 += delta * delta2;
  if (x < s.min) s.min = x;
  if (x > s.max) s.max = x;
  return s;
}

function variance(s: RunningStats): number {
  return s.n > 1 ? s.m2 / (s.n - 1) : 0;
}

function stddev(s: RunningStats): number {
  return Math.sqrt(variance(s));
}

// ────────────────────────────────────────────────────────────
// Arena Engine
// ────────────────────────────────────────────────────────────

export class ArenaEngine {
  private config: ArenaEngineConfig;
  private trades: ArenaTrade[] = [];
  private signals: ArenaSignal[] = [];
  private closedTrades: ArenaTrade[] = [];
  private listeners = new Set<ArenaEventListener>();
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private decisionsToday = 0;
  private lastDecisionTime: number | null = null;
  private capital: number;
  private signalCounter = 0;
  private tradeCounter = 0;

  // Self-evolving statistics
  private priceHistory = new Map<string, number[]>();
  private volumeHistory = new Map<string, number[]>();
  private returnStats = new Map<string, RunningStats>();
  private volatilityStats = new Map<string, RunningStats>();
  private modelVersion = "arena_v1.0.0";
  private featuresVersion = "feat_v1.0.0";

  // Adaptive thresholds — tighten or loosen based on performance
  private adaptiveConfidenceThreshold = 0.55;
  private adaptiveMinRR = 1.5;
  private winningStreak = 0;
  private losingStreak = 0;

  // Market feature cache (updated per tick)
  private featureCache = new Map<string, MarketFeatures>();

  constructor(config?: Partial<ArenaEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.capital = this.config.initialCapital;
  }

  // ── Lifecycle ──────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    // Subscribe to live market data
    marketEngine.subscribe((snap) => this.onMarketSnapshot(snap));

    // Snapshot emission: batched at ~250ms
    this.snapshotTimer = setInterval(() => this.emitSnapshot(), 250);
  }

  stop(): void {
    this.running = false;
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  updateConfig(partial: Partial<ArenaEngineConfig>): void {
    Object.assign(this.config, partial);
  }

  // ── Event listener ──────────────────────────────────────

  subscribe(fn: ArenaEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── Market data ingestion ──────────────────────────────

  private onMarketSnapshot(snap: EngineSnapshot): void {
    // 1. Manage open trades (TP/SL/trailing)
    for (const trade of [...this.trades]) {
      this.manageOpenTrade(trade, snap);
    }

    // 2. Update feature cache for each symbol
    for (const symbol of PAIRS) {
      this.updateFeatures(symbol.exchange, snap);
    }

    // 3. Evaluate signals for each symbol
    for (const symbol of PAIRS) {
      this.evaluateSymbol(symbol.exchange, snap);
    }
  }

  // ── Feature extraction ─────────────────────────────────

  private updateFeatures(exchangeSymbol: string, snap: EngineSnapshot): void {
    const snapshot = snap.symbols[exchangeSymbol];
    if (!snapshot || snapshot.price <= 0) return;

    // Track price and volume history
    if (!this.priceHistory.has(exchangeSymbol)) this.priceHistory.set(exchangeSymbol, []);
    if (!this.volumeHistory.has(exchangeSymbol)) this.volumeHistory.set(exchangeSymbol, []);

    const prices = this.priceHistory.get(exchangeSymbol)!;
    const volumes = this.volumeHistory.get(exchangeSymbol)!;

    prices.push(snapshot.price);
    volumes.push(snapshot.volume24h);

    // Keep last 1000 points
    if (prices.length > 1000) prices.splice(0, prices.length - 1000);
    if (volumes.length > 1000) volumes.splice(0, volumes.length - 1000);

    // Get candles for indicator calculation
    const candles15m = marketEngine.getCandles(exchangeSymbol, "15m");
    const candles1h = marketEngine.getCandles(exchangeSymbol, "1h");

    // Compute returns
    if (prices.length >= 2) {
      const returns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }
      let stats = this.returnStats.get(exchangeSymbol);
      if (!stats) {
        stats = { n: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity };
        this.returnStats.set(exchangeSymbol, stats);
      }
      const latestReturn = returns[returns.length - 1];
      updateRunningStats(stats, latestReturn);
    }

    // Compute volatility (rolling 20-period std of returns)
    const vol = this.computeVolatility(exchangeSymbol);

    // EMA calculation
    const ema20 = this.computeEMA(exchangeSymbol, 20);
    const ema50 = this.computeEMA(exchangeSymbol, 50);
    const ema200 = this.computeEMA(exchangeSymbol, 200);

    // RSI
    const rsi = this.computeRSI(exchangeSymbol, 14);

    // ATR
    const atr = this.computeATR(candles15m, 14);
    const atr1h = this.computeATR(candles1h, 14);

    // Donchian breakout
    const breakoutHigh = this.computeDonchianHigh(candles15m, 20);
    const breakoutLow = this.computeDonchianLow(candles15m, 20);

    // Volume relative to average
    const volMA = this.computeVolumeMA(exchangeSymbol, 20);
    const currentVolume = snapshot.volume24h;
    const volumeRatio = volMA > 0 ? currentVolume / volMA : 1;

    // Momentum (rate of change)
    const momentum = this.computeMomentum(exchangeSymbol, 10);

    // Trend strength (ADX approximation from directional movement)
    const trendStrength = this.computeTrendStrength(candles15m);

    // Spread estimate (using last known tick vs current)
    const spreadBps = this.estimateSpreadBps(exchangeSymbol);

    // Determine regime
    const regime = this.classifyRegime(
      ema20, ema50, ema200, rsi, vol, trendStrength, volumeRatio,
    );

    const features: MarketFeatures = {
      symbol: exchangeSymbol,
      price: snapshot.price,
      ema20,
      ema50,
      ema200,
      rsi,
      atr,
      atr1h,
      breakoutHigh,
      breakoutLow,
      volumeRatio,
      momentum,
      trendStrength,
      volatility: vol,
      spreadBps,
      regime,
      lastUpdate: Date.now(),
    };

    this.featureCache.set(exchangeSymbol, features);
  }

  // ── Indicator calculations ─────────────────────────────

  private computeEMA(exchangeSymbol: string, period: number): number {
    const prices = this.priceHistory.get(exchangeSymbol) ?? [];
    if (prices.length < period) return prices.length > 0 ? prices[prices.length - 1] : 0;

    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private computeRSI(exchangeSymbol: string, period: number): number {
    const prices = this.priceHistory.get(exchangeSymbol) ?? [];
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  private computeATR(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 0;

    let atr = 0;
    const trs: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }

    if (trs.length < period) return 0;

    // Initial SMA
    atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

    // Smoothed
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }

    return atr;
  }

  private computeDonchianHigh(candles: Candle[], period: number): number {
    if (candles.length < period) return 0;
    let max = -Infinity;
    for (let i = candles.length - period; i < candles.length; i++) {
      if (candles[i].high > max) max = candles[i].high;
    }
    return max;
  }

  private computeDonchianLow(candles: Candle[], period: number): number {
    if (candles.length < period) return Infinity;
    let min = Infinity;
    for (let i = candles.length - period; i < candles.length; i++) {
      if (candles[i].low < min) min = candles[i].low;
    }
    return min;
  }

  private computeVolumeMA(exchangeSymbol: string, period: number): number {
    const volumes = this.volumeHistory.get(exchangeSymbol) ?? [];
    if (volumes.length < period) return volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
    let sum = 0;
    for (let i = volumes.length - period; i < volumes.length; i++) {
      sum += volumes[i];
    }
    return sum / period;
  }

  private computeMomentum(exchangeSymbol: string, period: number): number {
    const prices = this.priceHistory.get(exchangeSymbol) ?? [];
    if (prices.length < period + 1) return 0;
    return (prices[prices.length - 1] - prices[prices.length - 1 - period]) / prices[prices.length - 1 - period];
  }

  private computeVolatility(exchangeSymbol: string): number {
    const stats = this.returnStats.get(exchangeSymbol);
    if (!stats || stats.n < 20) return 0;
    return stddev(stats);
  }

  private computeTrendStrength(candles: Candle[]): number {
    if (candles.length < 20) return 0;
    // Simple directional movement approximation
    let upBars = 0;
    let downBars = 0;
    for (let i = candles.length - 20; i < candles.length; i++) {
      const change = candles[i].close - candles[i].open;
      if (change > 0) upBars++;
      else downBars++;
    }
    return Math.abs(upBars - downBars) / 20;
  }

  private estimateSpreadBps(exchangeSymbol: string): number {
    // Conservative estimate for liquid pairs
    const prices = this.priceHistory.get(exchangeSymbol) ?? [];
    if (prices.length < 2) return 10;
    const price = prices[prices.length - 1];
    if (price <= 0) return 100;
    // Estimate from microstructure: use 0.01% base + volatility adjustment
    const vol = this.computeVolatility(exchangeSymbol);
    return Math.max(1, 1 + vol * 1000);
  }

  // ── Regime classification ──────────────────────────────

  private classifyRegime(
    ema20: number, ema50: number, ema200: number,
    rsi: number, volatility: number, trendStrength: number,
    volumeRatio: number,
  ): MarketRegime {
    const bullish = ema20 > ema50 && ema50 > ema200;
    const bearish = ema20 < ema50 && ema50 < ema200;

    if (volatility > 0.03) return "high_volatility";
    if (volatility < 0.005 && trendStrength < 0.2) return "low_volatility";
    if (bullish && trendStrength > 0.3) return "strong_uptrend";
    if (bullish) return "uptrend";
    if (bearish && trendStrength > 0.3) return "strong_downtrend";
    if (bearish) return "downtrend";
    return "ranging";
  }

  // ── Signal evaluation ─────────────────────────────────

  private evaluateSymbol(exchangeSymbol: string, snap: EngineSnapshot): void {
    if (!this.running) return;

    const features = this.featureCache.get(exchangeSymbol);
    if (!features || Date.now() - features.lastUpdate > 30_000) return;

    const arenaSymbol = PAIRS.find(p => p.exchange === exchangeSymbol)?.symbol;
    if (!arenaSymbol) return;

    // Find active trades for this symbol
    const activeTrades = this.trades.filter(
      t => t.symbol === arenaSymbol && (t.status === "open" || t.status === "pending"),
    );

    // Don't open duplicate positions
    if (activeTrades.length > 0) return;

    // Max simultaneous positions across all symbols
    const totalOpen = this.trades.filter(t => t.status === "open" || t.status === "pending").length;
    if (totalOpen >= this.config.maxSimultaneousPositions) return;

    // ── Evaluate LONG side ──
    if (this.config.longsEnabled) {
      const longSignal = this.evaluateSide(exchangeSymbol, arenaSymbol, "long", features, snap);
      if (longSignal) this.processSignal(longSignal);
    }

    // ── Evaluate SHORT side ──
    if (this.config.shortsEnabled) {
      const shortSignal = this.evaluateSide(exchangeSymbol, arenaSymbol, "short", features, snap);
      if (shortSignal) this.processSignal(shortSignal);
    }
  }

  private evaluateSide(
    exchangeSymbol: string,
    arenaSymbol: string,
    side: TradeSide,
    features: MarketFeatures,
    snap: EngineSnapshot,
  ): ArenaSignal | null {
    const f = features;
    const price = f.price;
    if (price <= 0) return null;

    // ── Gate 1: Data freshness ──
    const symSnap = snap.symbols[exchangeSymbol];
    const lastTickAge = symSnap?.lastTickTime ? Date.now() - symSnap.lastTickTime : Infinity;

    const health = computeDataHealth({
      feedHealth: snap.feedHealth === "error" ? "error" : snap.feedHealth === "connected" ? "connected" : "stale",
      provider: snap.activeProvider,
      lastTickMsAgo: lastTickAge,
      lastCandleMsAgo: lastTickAge,
      hasGaps: false,
      exchange: exchangeSymbol,
    });

    // ── Build ModuleInput for the fusion engine ──
    const moduleInput: ModuleInput = {
      symbol: arenaSymbol,
      exchangeSymbol,
      side,
      candles15m: marketEngine.getCandles(exchangeSymbol, "15m"),
      candles1h: marketEngine.getCandles(exchangeSymbol, "1h"),
      candles4h: marketEngine.getCandles(exchangeSymbol, "4h"),
      livePrice: price,
      ticker: symSnap ? {
        price: symSnap.price,
        change24hPercent: symSnap.change24hPercent,
        high24h: symSnap.high24h,
        low24h: symSnap.low24h,
        volume24hBase: 0,
        quoteVolume24h: symSnap.volume24h,
        open24h: symSnap.open24h,
      } : null,
      orderBook: null,
      priceHistory: this.priceHistory.get(exchangeSymbol) ?? [],
      volumeHistory: this.volumeHistory.get(exchangeSymbol) ?? [],
      now: Date.now(),
    };

    // ── Run the Decision Fusion Engine ──
    const fusionResult = decisionFusionEngine.evaluate(moduleInput);

    // ── Log every decision ──
    decisionLogger.logDecision({
      symbol: arenaSymbol,
      side,
      fusionResult,
      price,
      change24h: symSnap?.change24hPercent ?? 0,
      high24h: symSnap?.high24h ?? 0,
      low24h: symSnap?.low24h ?? 0,
      volume24h: symSnap?.volume24h ?? 0,
      regime: f.regime,
      tradeId: null,
    });

    // ── If fusion says NO_TRADE, stop here ──
    if (fusionResult.decision === "NO_TRADE") return null;

    // ── Secondary risk gates (defense in depth) ──
    if (f.spreadBps > this.config.maxSpreadBps) return null;
    if (f.volatility > 0.05) return null;

    // ── Use fusion engine's probability and EV ──
    const modelProbability = fusionResult.modelProbability;
    const expectedValue = fusionResult.expectedValue;

    // ── Compute stop loss and take profit ──
    const atrForRisk = f.atr > 0 ? f.atr : price * 0.01;
    const stopDistance = atrForRisk * 2;
    const targetDistance = atrForRisk * 4;

    const stopLoss = side === "long" ? price - stopDistance : price + stopDistance;
    const takeProfit = side === "long" ? price + targetDistance : price - targetDistance;

    // ── Position sizing (risk-based) ──
    const riskAmount = this.capital * this.config.riskPerTrade;
    const riskPerUnit = Math.abs(price - stopLoss);
    if (riskPerUnit <= 0) return null;

    const positionSize = riskAmount / riskPerUnit;
    const positionValue = positionSize * price;

    // ── Final risk gates ──
    if (modelProbability < this.adaptiveConfidenceThreshold) return null;
    if (expectedValue < this.config.minExpectedValue) return null;
    const riskReward = riskPerUnit > 0 ? targetDistance / riskPerUnit : 0;
    if (riskReward < this.adaptiveMinRR) return null;

    // ── Build signal ──
    this.signalCounter++;
    const signalId = `sig_${Date.now()}_${this.signalCounter}`;

    const evidence: ArenaSignalEvidence = decisionFusionEngine.toSignalEvidence(fusionResult);

    const signal: ArenaSignal = {
      signalId,
      symbol: arenaSymbol,
      exchange: "binance",
      side,
      strategy: "fusion_engine_v1",
      timeframe: "15m",
      higherTimeframe: "1h",
      entry: price,
      stopLoss,
      takeProfit,
      riskReward,
      positionSize,
      risk: riskAmount,
      modelProbability,
      expectedReturn: expectedValue + (this.config.feesBps + this.config.slippageBps) / 10_000,
      expectedValue,
      expectedAdverseExcursion: stopDistance * 0.8,
      expectedFavorableExcursion: targetDistance * 0.6,
      marketRegime: f.regime,
      modelVersion: this.modelVersion,
      featuresVersion: this.featuresVersion,
      signalTime: Date.now(),
      evidence,
      reasonCodes: fusionResult.reasonCodes,
      summary: fusionResult.summary + ` Entry ${formatPrice(price)}, SL ${formatPrice(stopLoss)}, TP ${formatPrice(takeProfit)}. R:R 1:${riskReward.toFixed(2)}.`,
      status: "pending",
      uncertainty: fusionResult.uncertainty,
      dataHealthAtSignal: health,
    };

    return signal;
  }

  // ── Model probability estimation ──────────────────────
  // Quantitative ensemble — not an LLM. Uses multiple
  // simple models and averages their outputs.

  private estimateProbability(f: MarketFeatures, side: TradeSide): number {
    const scores: number[] = [];

    // Model 1: Trend alignment strength
    const trendScore = f.ema50 > 0 && f.ema200 > 0
      ? side === "long"
        ? Math.min(1, (f.ema50 / f.ema200 - 1) * 50 + 0.5)
        : Math.min(1, (1 - f.ema50 / f.ema200) * 50 + 0.5)
      : 0.5;
    scores.push(Math.max(0, Math.min(1, trendScore)));

    // Model 2: RSI positioning
    const rsiScore = side === "long"
      ? f.rsi > 50 && f.rsi < 70 ? 0.6 + (f.rsi - 50) / 100 : 0.4
      : f.rsi < 50 && f.rsi > 30 ? 0.6 + (50 - f.rsi) / 100 : 0.4;
    scores.push(rsiScore);

    // Model 3: Breakout strength
    const breakoutRange = f.breakoutHigh - f.breakoutLow;
    const breakoutScore = breakoutRange > 0
      ? Math.min(1, Math.abs(f.price - (f.breakoutHigh + f.breakoutLow) / 2) / (breakoutRange / 2))
      : 0.5;
    scores.push(0.5 + breakoutScore * 0.3);

    // Model 4: Volume confirmation
    const volScore = Math.min(1, f.volumeRatio / 2);
    scores.push(volScore);

    // Model 5: Trend strength
    scores.push(0.5 + f.trendStrength * 0.4);

    // Model 6: Volatility regime (moderate vol is best)
    const volRegimeScore = f.volatility > 0.01 && f.volatility < 0.03 ? 0.7 : 0.45;
    scores.push(volRegimeScore);

    // Ensemble average
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    // Clip to reasonable range
    return Math.max(0.3, Math.min(0.85, avg));
  }

  private computeUncertainty(f: MarketFeatures): number {
    // Higher uncertainty when:
    // - volatility is extreme
    // - trend strength is low
    // - volume is low
    let u = 0.2; // base uncertainty
    if (f.volatility > 0.03) u += 0.15;
    if (f.trendStrength < 0.2) u += 0.1;
    if (f.volumeRatio < 1.0) u += 0.1;
    if (f.rsi > 70 || f.rsi < 30) u += 0.05;
    return Math.min(0.5, u);
  }

  // ── Signal processing & trade execution ───────────────

  private processSignal(signal: ArenaSignal): void {
    this.signals.push(signal);
    if (this.signals.length > 200) this.signals.splice(0, this.signals.length - 200);

    this.lastDecisionTime = Date.now();
    this.decisionsToday++;

    // Create demo trade
    this.executeDemoTrade(signal);
  }

  private executeDemoTrade(signal: ArenaSignal): void {
    this.tradeCounter++;
    const tradeId = `trd_${Date.now()}_${this.tradeCounter}`;

    const trade: ArenaTrade = {
      tradeId,
      symbol: signal.symbol,
      exchange: signal.exchange,
      side: signal.side,
      strategy: signal.strategy,
      timeframe: signal.timeframe,
      higherTimeframe: signal.higherTimeframe,
      entryPrice: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      trailingStop: null,
      riskReward: signal.riskReward,
      positionSize: signal.positionSize,
      risk: signal.risk,
      modelProbability: signal.modelProbability,
      expectedReturn: signal.expectedReturn,
      expectedValue: signal.expectedValue,
      marketRegime: signal.marketRegime,
      modelVersion: signal.modelVersion,
      featuresVersion: signal.featuresVersion,
      signalTime: signal.signalTime,
      openTime: Date.now(),
      status: "open",
      exitPrice: null,
      exitTime: null,
      exitReason: null,
      realizedPnl: null,
      fees: null,
      slippage: null,
      signalId: signal.signalId,
      reasonCodes: signal.reasonCodes,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.trades.push(trade);

    // Update signal status
    const sig = this.signals.find(s => s.signalId === signal.signalId);
    if (sig) sig.status = "accepted";
  }

  // ── Trade management ──────────────────────────────────

  private manageOpenTrade(trade: ArenaTrade, snap: EngineSnapshot): void {
    if (trade.status !== "open") return;

    const arenaPair = PAIRS.find(p => p.symbol === trade.symbol);
    const exchangeSymbol = arenaPair?.exchange;
    if (!exchangeSymbol) return;

    const symSnap = snap.symbols[exchangeSymbol];
    if (!symSnap || symSnap.price <= 0) return;

    const currentPrice = symSnap.price;

    if (trade.side === "long") {
      // Check take profit
      if (currentPrice >= trade.takeProfit) {
        this.closeTrade(trade, currentPrice, "take_profit");
        return;
      }
      // Check stop loss
      if (currentPrice <= trade.stopLoss) {
        this.closeTrade(trade, currentPrice, "stop_loss");
        return;
      }
      // Update trailing stop (if price has moved 1.5x risk in our favor)
      const riskDist = trade.entryPrice - trade.stopLoss;
      if (currentPrice > trade.entryPrice + riskDist * 1.5) {
        const newStop = currentPrice - riskDist * 0.5;
        if (!trade.trailingStop || newStop > trade.trailingStop) {
          trade.trailingStop = newStop;
          trade.stopLoss = newStop; // trail the stop
          trade.updatedAt = Date.now();
        }
      }
    } else {
      // Short side
      if (currentPrice <= trade.takeProfit) {
        this.closeTrade(trade, currentPrice, "take_profit");
        return;
      }
      if (currentPrice >= trade.stopLoss) {
        this.closeTrade(trade, currentPrice, "stop_loss");
        return;
      }
      const riskDist = trade.stopLoss - trade.entryPrice;
      if (currentPrice < trade.entryPrice - riskDist * 1.5) {
        const newStop = currentPrice + riskDist * 0.5;
        if (!trade.trailingStop || newStop < trade.trailingStop) {
          trade.trailingStop = newStop;
          trade.stopLoss = newStop;
          trade.updatedAt = Date.now();
        }
      }
    }

    // Time exit: close if held too long (48 candles on 15m = 12 hours)
    const maxHoldMs = 48 * 15 * 60 * 1000;
    if (trade.openTime && Date.now() - trade.openTime > maxHoldMs) {
      this.closeTrade(trade, currentPrice, "time_exit");
      return;
    }

    trade.updatedAt = Date.now();
  }

  private closeTrade(trade: ArenaTrade, exitPrice: number, reason: ArenaTrade["exitReason"]): void {
    trade.exitPrice = exitPrice;
    trade.exitTime = Date.now();
    trade.exitReason = reason;
    trade.status = "closed";

    // Calculate P&L
    const priceDiff = trade.side === "long"
      ? exitPrice - trade.entryPrice
      : trade.entryPrice - exitPrice;
    const grossPnl = priceDiff * trade.positionSize;
    const fees = trade.positionSize * trade.entryPrice * (this.config.feesBps / 10_000);
    const slippageCost = trade.positionSize * trade.entryPrice * (this.config.slippageBps / 10_000);
    const netPnl = grossPnl - fees - slippageCost;

    trade.realizedPnl = netPnl;
    trade.fees = fees;
    trade.slippage = slippageCost;
    trade.updatedAt = Date.now();

    // Update capital
    this.capital += netPnl;

    // Move to closed list
    this.closedTrades.push(trade);
    this.trades = this.trades.filter(t => t.tradeId !== trade.tradeId);

    // Adaptive learning from outcome
    this.adaptFromOutcome(trade, netPnl > 0);
  }

  // ── Self-evolving adaptation ──────────────────────────

  private adaptFromOutcome(trade: ArenaTrade, wasWin: boolean): void {
    if (wasWin) {
      this.winningStreak++;
      this.losingStreak = 0;
    } else {
      this.losingStreak++;
      this.winningStreak = 0;
    }

    // After 10 trades, start adapting thresholds
    if (this.closedTrades.length >= 10) {
      const recentTrades = this.closedTrades.slice(-20);
      const recentWins = recentTrades.filter(t => (t.realizedPnl ?? 0) > 0).length;
      const recentWinRate = recentWins / recentTrades.length;

      // If win rate is below 40%, tighten confidence threshold
      if (recentWinRate < 0.4) {
        this.adaptiveConfidenceThreshold = Math.min(0.7, this.adaptiveConfidenceThreshold + 0.01);
        this.adaptiveMinRR = Math.min(2.5, this.adaptiveMinRR + 0.05);
      }
      // If win rate is above 60%, loosen slightly for more opportunities
      else if (recentWinRate > 0.6) {
        this.adaptiveConfidenceThreshold = Math.max(0.45, this.adaptiveConfidenceThreshold - 0.005);
        this.adaptiveMinRR = Math.max(1.2, this.adaptiveMinRR - 0.02);
      }

      // Losing streak cooldown: after 3 consecutive losses, raise thresholds
      if (this.losingStreak >= 3) {
        this.adaptiveConfidenceThreshold = Math.min(0.75, this.adaptiveConfidenceThreshold + 0.02);
      }

      // Version bump on significant adaptation
      if (this.decisionsToday > 0 && this.decisionsToday % 50 === 0) {
        this.modelVersion = `arena_v1.${Math.floor(this.decisionsToday / 50)}.0`;
      }
    }
  }

  // ── Performance summary ────────────────────────────────

  private computePerformance(): ArenaPerformanceSummary {
    const closed = this.closedTrades;
    const winning = closed.filter(t => (t.realizedPnl ?? 0) > 0);
    const losing = closed.filter(t => (t.realizedPnl ?? 0) <= 0);
    const totalPnl = closed.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);

    const avgWin = winning.length > 0
      ? winning.reduce((s, t) => s + (t.realizedPnl ?? 0), 0) / winning.length
      : 0;
    const avgLoss = losing.length > 0
      ? losing.reduce((s, t) => s + (t.realizedPnl ?? 0), 0) / losing.length
      : 0;

    // Max drawdown
    let peak = this.config.initialCapital;
    let maxDd = 0;
    let equity = this.config.initialCapital;
    for (const t of closed) {
      equity += t.realizedPnl ?? 0;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDd) maxDd = dd;
    }

    // Sharpe ratio (simplified, using returns)
    const returns = closed.map(t => (t.realizedPnl ?? 0) / this.config.initialCapital);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const returnStd = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
      : 0;
    const sharpe = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0;

    // Average holding time
    const avgHold = closed.length > 0
      ? closed.reduce((s, t) => s + ((t.exitTime ?? t.updatedAt) - (t.openTime ?? t.createdAt)), 0) / closed.length
      : 0;

    return {
      totalTrades: closed.length,
      openTrades: this.trades.filter(t => t.status === "open").length,
      closedTrades: closed.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      totalPnl,
      winRate: closed.length > 0 ? winning.length / closed.length : 0,
      profitFactor: avgLoss !== 0 ? Math.abs(avgWin * winning.length) / Math.abs(avgLoss * losing.length) : 0,
      expectancy: closed.length > 0 ? totalPnl / closed.length : 0,
      averageWin: avgWin,
      averageLoss: avgLoss,
      averageHoldingSeconds: avgHold / 1000,
      maxDrawdown: maxDd,
      sharpeRatio: sharpe,
      sortinoRatio: sharpe, // simplified
      modelVersion: this.modelVersion,
      featuresVersion: this.featuresVersion,
      firstTradeTime: closed.length > 0 ? closed[0].createdAt : null,
      lastTradeTime: closed.length > 0 ? closed[closed.length - 1].updatedAt : null,
    };
  }

  // ── Snapshot emission ─────────────────────────────────

  private emitSnapshot(): void {
    const snapshot: ArenaSnapshot = {
      trades: [...this.trades],
      signals: [...this.signals].slice(-50),
      performance: this.computePerformance(),
      status: {
        enabled: this.running,
        modelVersion: this.modelVersion,
        paused: false,
        dataHealth: computeDataHealth({
          feedHealth: "connected",
          provider: "engine",
          lastTickMsAgo: 0,
          lastCandleMsAgo: 0,
          hasGaps: false,
          exchange: "binance",
        }),
        lastDecisionTime: this.lastDecisionTime,
        decisionsToday: this.decisionsToday,
        openPositions: this.trades.filter(t => t.status === "open").length,
        capital: this.capital,
      },
    };

    for (const fn of this.listeners) fn(snapshot);
  }

  // ── Public accessors ──────────────────────────────────

  getCapital(): number { return this.capital; }
  getOpenTrades(): ArenaTrade[] { return [...this.trades]; }
  getAllSignals(): ArenaSignal[] { return [...this.signals]; }
  getClosedTrades(): ArenaTrade[] { return [...this.closedTrades]; }
  getConfig(): ArenaEngineConfig { return { ...this.config }; }
  isActive(): boolean { return this.running; }
  getModelVersion(): string { return this.modelVersion; }
  getAdaptiveThresholds(): { confidence: number; minRR: number } {
    return { confidence: this.adaptiveConfidenceThreshold, minRR: this.adaptiveMinRR };
  }
}

// ── Helpers ─────────────────────────────────────────────

interface MarketFeatures {
  symbol: string;
  price: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  atr: number;
  atr1h: number;
  breakoutHigh: number;
  breakoutLow: number;
  volumeRatio: number;
  momentum: number;
  trendStrength: number;
  volatility: number;
  spreadBps: number;
  regime: MarketRegime;
  lastUpdate: number;
}

function formatPrice(price: number): string {
  if (price < 1) return `$${price.toFixed(4)}`;
  if (price < 100) return `$${price.toFixed(2)}`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Module-level singleton
export const arenaEngine = new ArenaEngine();
