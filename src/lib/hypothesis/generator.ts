// ============================================================
// AI HYPOTHESIS LABORATORY — Hypothesis Generator
//
// Automatically generates measurable, testable trading hypotheses
// from historical market patterns. Each hypothesis is a parameterized
// claim that can be backtested and validated.
//
// The generator scans market data for:
// - Trend breakout patterns
// - Mean reversion setups
// - Momentum shifts
// - Volatility regime changes
// - Volume anomalies
// - Cross-timeframe alignment
//
// Each generated hypothesis includes all required fields:
// conditions, entry/exit logic, risk assumptions, expected edge.
// ============================================================

import type { Candle, Interval } from "@/lib/market/types";
import type { TradeSide, MarketRegime } from "@/lib/arena/types";
import type {
  Hypothesis,
  HypothesisCondition,
  HypothesisCategory,
  EntryLogic,
  ExitLogic,
  RiskAssumptions,
  ExpectedEdge,
} from "./types";

// ── Indicator Helpers ───────────────────────────────────────

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    sum += tr;
  }
  return sum / period;
}

function donchianHigh(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  return Math.max(...candles.slice(-period).map(c => c.high));
}

function donchianLow(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  return Math.min(...candles.slice(-period).map(c => c.low));
}

function volumeRatio(candles: Candle[], shortPeriod = 5, longPeriod = 20): number | null {
  if (candles.length < longPeriod) return null;
  const shortAvg = candles.slice(-shortPeriod).reduce((s, c) => s + c.volume, 0) / shortPeriod;
  const longAvg = candles.slice(-longPeriod).reduce((s, c) => s + c.volume, 0) / longPeriod;
  return longAvg > 0 ? shortAvg / longAvg : null;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

// ── Pattern Detection ───────────────────────────────────────

interface PatternSignal {
  category: HypothesisCategory;
  side: TradeSide;
  conditions: HypothesisCondition[];
  description: string;
  confidence: number;
}

function detectPatterns(candles: Candle[]): PatternSignal[] {
  const signals: PatternSignal[] = [];
  if (candles.length < 50) return signals;

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];

  // ── Pattern 1: Trend Breakout ──
  const ema50 = ema(closes, 50);
  const ema20 = ema(closes, 20);
  const dcHigh = donchianHigh(candles, 20);
  const dcLow = donchianLow(candles, 20);
  const atrVal = atr(candles, 14);

  if (ema50 && ema20 && dcHigh && atrVal) {
    // Bullish breakout: price near Donchian high + uptrend
    if (price > dcHigh * 0.995 && ema20 > ema50) {
      signals.push({
        category: "trend_breakout",
        side: "long",
        conditions: [
          { indicator: "price_vs_donchian_high", operator: "gte", value: 0.995, required: true },
          { indicator: "ema20_vs_ema50", operator: "gt", value: 0, required: true },
          { indicator: "rsi14", operator: "between", value: 50, valueUpper: 75, required: true },
          { indicator: "volume_ratio", operator: "gt", value: 1.0, required: false, weight: 0.8 },
        ],
        description: `Bullish breakout: price near 20-period Donchian high (${dcHigh.toFixed(2)}) with EMA20 > EMA50 uptrend.`,
        confidence: 0.6,
      });
    }
    // Bearish breakout
    if (dcLow && price < dcLow * 1.005 && ema20 < ema50) {
      signals.push({
        category: "trend_breakout",
        side: "short",
        conditions: [
          { indicator: "price_vs_donchian_low", operator: "lte", value: 1.005, required: true },
          { indicator: "ema20_vs_ema50", operator: "lt", value: 0, required: true },
          { indicator: "rsi14", operator: "between", value: 25, valueUpper: 50, required: true },
        ],
        description: `Bearish breakout: price near 20-period Donchian low with EMA20 < EMA50 downtrend.`,
        confidence: 0.55,
      });
    }
  }

  // ── Pattern 2: Mean Reversion ──
  const rsiVal = rsi(closes, 14);
  if (rsiVal != null && ema50 && atrVal) {
    const distFromEma = (price - ema50) / ema50;
    // Oversold near support
    if (rsiVal < 30 && distFromEma < -0.02) {
      signals.push({
        category: "mean_reversion",
        side: "long",
        conditions: [
          { indicator: "rsi14", operator: "lt", value: 30, required: true },
          { indicator: "dist_from_ema50_pct", operator: "lt", value: -2, required: true },
          { indicator: "atr_percent", operator: "gt", value: 0.5, required: false, weight: 0.5 },
        ],
        description: `Mean reversion: RSI(${rsiVal.toFixed(1)}) oversold, price ${(distFromEma * 100).toFixed(1)}% below EMA50.`,
        confidence: 0.5,
      });
    }
    // Overbought near resistance
    if (rsiVal > 70 && distFromEma > 0.02) {
      signals.push({
        category: "mean_reversion",
        side: "short",
        conditions: [
          { indicator: "rsi14", operator: "gt", value: 70, required: true },
          { indicator: "dist_from_ema50_pct", operator: "gt", value: 2, required: true },
        ],
        description: `Mean reversion: RSI(${rsiVal.toFixed(1)}) overbought, price ${(distFromEma * 100).toFixed(1)}% above EMA50.`,
        confidence: 0.5,
      });
    }
  }

  // ── Pattern 3: Momentum ──
  if (closes.length >= 15 && ema50) {
    const roc5 = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6];
    const roc10 = (closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11];
    const vol = volumeRatio(candles, 5, 20);

    if (roc5 > 0.01 && roc10 > 0.005 && vol && vol > 1.2 && price > ema50) {
      signals.push({
        category: "momentum",
        side: "long",
        conditions: [
          { indicator: "roc5", operator: "gt", value: 1, required: true },
          { indicator: "roc10", operator: "gt", value: 0.5, required: true },
          { indicator: "volume_ratio", operator: "gt", value: 1.2, required: true },
          { indicator: "price_above_ema50", operator: "eq", value: 1, required: true },
        ],
        description: `Strong momentum: ROC5=${(roc5 * 100).toFixed(2)}%, ROC10=${(roc10 * 100).toFixed(2)}%, vol=${vol.toFixed(2)}x avg.`,
        confidence: 0.55,
      });
    }
  }

  // ── Pattern 4: Volatility Regime ──
  if (atrVal && candles.length >= 30) {
    const recentAtr = atr(candles.slice(-15), 10);
    const olderAtr = atr(candles.slice(-30, -15), 10);
    const atrPct = price > 0 ? (atrVal / price) * 100 : null;
    const volExpanding = recentAtr && olderAtr && olderAtr > 0 ? recentAtr / olderAtr : null;

    if (atrPct && atrPct > 1.5 && atrPct < 4 && volExpanding && volExpanding > 1.3 && ema50 && price > ema50) {
      signals.push({
        category: "volatility_regime",
        side: "long",
        conditions: [
          { indicator: "atr_percent", operator: "between", value: 1.5, valueUpper: 4, required: true },
          { indicator: "vol_expansion_ratio", operator: "gt", value: 1.3, required: true },
          { indicator: "price_above_ema50", operator: "eq", value: 1, required: true },
        ],
        description: `Volatility expanding (${volExpanding.toFixed(2)}x) in favorable range (${atrPct.toFixed(2)}% ATR), uptrend intact.`,
        confidence: 0.55,
      });
    }
  }

  // ── Pattern 5: Volume Profile ──
  const vol = volumeRatio(candles, 3, 20);
  if (vol && vol > 2.0 && closes.length >= 10) {
    const recentChange = (closes[closes.length - 1] - closes[closes.length - 4]) / closes[closes.length - 4];
    if (Math.abs(recentChange) > 0.015) {
      signals.push({
        category: "volume_profile",
        side: recentChange > 0 ? "long" : "short",
        conditions: [
          { indicator: "volume_ratio_3_20", operator: "gt", value: 2.0, required: true },
          { indicator: "roc3", operator: "gt", value: 1.5, required: true },
        ],
        description: `Volume spike (${vol.toFixed(2)}x avg) with directional move (${(recentChange * 100).toFixed(2)}%).`,
        confidence: 0.5,
      });
    }
  }

  // ── Pattern 6: Cross-Timeframe Alignment ──
  // This uses the 1h candles if available (passed as the full candle array
  // since we don't have multi-TF here — we use the same candles for a longer EMA)
  if (closes.length >= 100 && ema50) {
    const ema200 = ema(closes, 200);
    if (ema200) {
      const bullAlign = ema20 && ema20 > ema50 && ema50 > ema200 && price > ema20;
      const bearAlign = ema20 && ema20 < ema50 && ema50 < ema200 && price < ema20;
      const dcH = donchianHigh(candles, 10);
      const dcL = donchianLow(candles, 10);

      if (bullAlign && dcH && price > dcH * 0.99) {
        signals.push({
          category: "cross_timeframe",
          side: "long",
          conditions: [
            { indicator: "ema_alignment_bull", operator: "eq", value: 1, required: true },
            { indicator: "price_near_donchian_high", operator: "gte", value: 0.99, required: true },
          ],
          description: `Full bullish alignment: EMA20 > EMA50 > EMA200, price near Donchian high.`,
          confidence: 0.65,
        });
      }
      if (bearAlign && dcL && price < dcL * 1.01) {
        signals.push({
          category: "cross_timeframe",
          side: "short",
          conditions: [
            { indicator: "ema_alignment_bear", operator: "eq", value: 1, required: true },
            { indicator: "price_near_donchian_low", operator: "lte", value: 1.01, required: true },
          ],
          description: `Full bearish alignment: EMA20 < EMA50 < EMA200, price near Donchian low.`,
          confidence: 0.6,
        });
      }
    }
  }

  return signals;
}

// ── Default Configurations ──────────────────────────────────

const DEFAULT_RISK: RiskAssumptions = {
  riskPerTrade: 0.005,
  maxPositions: 1,
  slippageBps: 5,
  feesBps: 10,
  maxDrawdownPercent: 15,
};

const DEFAULT_EDGE: ExpectedEdge = {
  minSharpe: 1.0,
  minWinRate: 0.4,
  minProfitFactor: 1.3,
  minExpectancy: 0.001,
  minTrades: 30,
};

// ── Generator ───────────────────────────────────────────────

export interface GeneratorConfig {
  risk: Partial<RiskAssumptions>;
  edge: Partial<ExpectedEdge>;
  /** Symbols to scan. */
  symbols: string[];
  /** Timeframes to test. */
  timeframes: Interval[];
}

let hypothesisCounter = 0;

/**
 * Generate hypotheses from candle data for a single symbol.
 * Returns parameterized hypotheses ready for backtesting.
 */
export function generateHypotheses(
  symbol: string,
  candles: Candle[],
  config?: Partial<GeneratorConfig>,
): Hypothesis[] {
  const now = Date.now();
  const risk = { ...DEFAULT_RISK, ...config?.risk };
  const edge = { ...DEFAULT_EDGE, ...config?.edge };
  const timeframes = config?.timeframes ?? ["15m", "1h"];
  const patterns = detectPatterns(candles);

  const hypotheses: Hypothesis[] = [];

  for (const pattern of patterns) {
    for (const timeframe of timeframes) {
      hypothesisCounter++;
      const id = `hyp_${now}_${hypothesisCounter}`;

      // Build entry logic from pattern conditions
      const requiredConditions = pattern.conditions.filter(c => c.required);
      const optionalConditions = pattern.conditions.filter(c => !c.required);

      const entryLogic: EntryLogic = {
        conditions: pattern.conditions,
        minOptionalConditions: optionalConditions.length > 0 ? 1 : 0,
        confirmationBars: pattern.category === "trend_breakout" ? 2 : 1,
        maxEntryDelay: pattern.category === "momentum" ? 3 : 5,
      };

      // Build exit logic based on category
      const exitLogic = buildExitLogic(pattern.category);

      const hypothesis: Hypothesis = {
        id,
        name: `${pattern.category}_${pattern.side}_${symbol.replace("/", "")}_${timeframe}`,
        description: pattern.description,
        category: pattern.category,
        symbol,
        timeframe,
        higherTimeframe: timeframe === "15m" ? "1h" : timeframe === "1h" ? "4h" : null,
        side: pattern.side,
        conditions: pattern.conditions,
        entryLogic,
        exitLogic,
        riskAssumptions: risk,
        expectedEdge: edge,
        status: "draft",
        createdAt: now,
        lastTestedAt: null,
        version: 1,
        tags: [pattern.category, pattern.side, symbol, timeframe],
      };

      hypotheses.push(hypothesis);
    }
  }

  return hypotheses;
}

function buildExitLogic(category: HypothesisCategory): ExitLogic {
  switch (category) {
    case "trend_breakout":
      return {
        stopLoss: { type: "atr", value: 2.0 },
        takeProfit: { type: "rr_ratio", value: 2.5 },
        trailingStop: { enabled: true, activationRR: 1.5, trailPercent: 50 },
        maxHoldBars: 48,
        timeExit: null,
      };
    case "mean_reversion":
      return {
        stopLoss: { type: "atr", value: 1.5 },
        takeProfit: { type: "atr", value: 2.0 },
        trailingStop: null,
        maxHoldBars: 24,
        timeExit: null,
      };
    case "momentum":
      return {
        stopLoss: { type: "atr", value: 2.0 },
        takeProfit: { type: "rr_ratio", value: 3.0 },
        trailingStop: { enabled: true, activationRR: 1.0, trailPercent: 40 },
        maxHoldBars: 36,
        timeExit: null,
      };
    case "volatility_regime":
      return {
        stopLoss: { type: "atr", value: 2.5 },
        takeProfit: { type: "rr_ratio", value: 2.0 },
        trailingStop: { enabled: true, activationRR: 1.5, trailPercent: 50 },
        maxHoldBars: 48,
        timeExit: null,
      };
    case "volume_profile":
      return {
        stopLoss: { type: "atr", value: 1.5 },
        takeProfit: { type: "atr", value: 3.0 },
        trailingStop: null,
        maxHoldBars: 20,
        timeExit: null,
      };
    case "cross_timeframe":
      return {
        stopLoss: { type: "atr", value: 2.0 },
        takeProfit: { type: "rr_ratio", value: 3.0 },
        trailingStop: { enabled: true, activationRR: 2.0, trailPercent: 60 },
        maxHoldBars: 60,
        timeExit: null,
      };
    default:
      return {
        stopLoss: { type: "atr", value: 2.0 },
        takeProfit: { type: "rr_ratio", value: 2.0 },
        trailingStop: null,
        maxHoldBars: 48,
        timeExit: null,
      };
  }
}

/**
 * Generate a batch of hypotheses for multiple symbols.
 * Deduplicates similar hypotheses.
 */
export function generateBatch(
  symbolCandles: Map<string, Candle[]>,
  config?: Partial<GeneratorConfig>,
): Hypothesis[] {
  const allHypotheses: Hypothesis[] = [];

  for (const [symbol, candles] of symbolCandles) {
    const hypotheses = generateHypotheses(symbol, candles, config);
    allHypotheses.push(...hypotheses);
  }

  // Deduplicate: if two hypotheses have identical conditions for the same symbol/timeframe/side,
  // keep the one with higher confidence
  const seen = new Map<string, Hypothesis>();
  for (const h of allHypotheses) {
    const key = `${h.symbol}|${h.timeframe}|${h.side}|${h.category}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, h);
    } else if (h.conditions.length > existing.conditions.length) {
      // More specific hypothesis wins
      seen.set(key, h);
    }
  }

  return Array.from(seen.values());
}
