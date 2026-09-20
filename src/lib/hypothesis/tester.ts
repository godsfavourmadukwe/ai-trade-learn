// ============================================================
// AI HYPOTHESIS LABORATORY — Hypothesis Tester
//
// Backtests hypotheses using chronological historical data with:
// - Train / Validation / Out-of-Sample splitting
// - Walk-forward validation
// - Transaction costs, spread, slippage
// - Market regime analysis per trade
// - Equity curve and performance metrics
//
// NO DATA LEAKAGE: every indicator uses only candles up to
// (and including) the current bar. No future information.
// ============================================================

import type { Candle, Interval } from "@/lib/market/types";
import type { TradeSide, MarketRegime } from "@/lib/arena/types";
import type {
  Hypothesis,
  BacktestResult,
  BacktestTrade,
  TestDataSplit,
  WalkForwardResult,
  WalkForwardWindow,
  SensitivityResult,
  HypothesisTestResult,
  HypothesisCondition,
} from "./types";

// ── Indicator Helpers (no-lookahead versions) ───────────────

function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
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

function detectRegime(closes: number[]): MarketRegime {
  if (closes.length < 50) return "unknown";
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  if (!ema20 || !ema50) return "unknown";
  const price = closes[closes.length - 1];
  const bull = ema20 > ema50;
  const above = price > ema50;
  if (bull && above) return "uptrend";
  if (!bull && !above) return "downtrend";
  return "ranging";
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

// ── Condition Evaluator ─────────────────────────────────────

interface BarIndicators {
  price: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
  atrPercent: number | null;
  volumeRatio: number | null;
  donchianHigh20: number | null;
  donchianLow20: number | null;
  roc5: number | null;
  roc10: number | null;
  distFromEma50Pct: number | null;
}

function computeBarIndicators(candles: Candle[], barIndex: number): BarIndicators {
  const slice = candles.slice(0, barIndex + 1);
  const closes = slice.map(c => c.close);
  const price = closes[closes.length - 1];
  const ema20Val = ema(closes, 20);
  const ema50Val = ema(closes, 50);
  const ema200Val = closes.length >= 200 ? ema(closes, 200) : null;
  const rsiVal = rsi(closes, 14);
  const atrVal = atr(slice, 14);
  const atrPct = atrVal && price > 0 ? (atrVal / price) * 100 : null;

  // Volume ratio
  const vols = slice.slice(-20).map(c => c.volume);
  const shortVols = slice.slice(-5).map(c => c.volume);
  const longAvg = vols.length >= 20 ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  const shortAvg = shortVols.reduce((a, b) => a + b, 0) / shortVols.length;
  const vr = longAvg && longAvg > 0 ? shortAvg / longAvg : null;

  // Donchian
  const dcH = slice.length >= 20 ? Math.max(...slice.slice(-20).map(c => c.high)) : null;
  const dcL = slice.length >= 20 ? Math.min(...slice.slice(-20).map(c => c.low)) : null;

  // ROC
  const roc5Val = closes.length >= 6 ? (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6] * 100 : null;
  const roc10Val = closes.length >= 11 ? (closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11] * 100 : null;

  // Distance from EMA50
  const distEma50 = ema50Val && price > 0 ? ((price - ema50Val) / ema50Val) * 100 : null;

  return {
    price,
    ema20: ema20Val,
    ema50: ema50Val,
    ema200: ema200Val,
    rsi14: rsiVal,
    atr14: atrVal,
    atrPercent: atrPct,
    volumeRatio: vr,
    donchianHigh20: dcH,
    donchianLow20: dcL,
    roc5: roc5Val,
    roc10: roc10Val,
    distFromEma50Pct: distEma50,
  };
}

function evaluateCondition(cond: HypothesisCondition, ind: BarIndicators): boolean {
  const val = getIndicatorValue(cond.indicator, ind);
  if (val === null) return false;

  switch (cond.operator) {
    case "gt": return val > cond.value;
    case "lt": return val < cond.value;
    case "gte": return val >= cond.value;
    case "lte": return val <= cond.value;
    case "eq": return Math.abs(val - cond.value) < 0.001;
    case "between": return val >= cond.value && val <= (cond.valueUpper ?? cond.value);
    case "crosses_above": return val > cond.value; // simplified: just check threshold
    case "crosses_below": return val < cond.value;
    default: return false;
  }
}

function getIndicatorValue(name: string, ind: BarIndicators): number | null {
  switch (name) {
    case "price_vs_donchian_high": return ind.donchianHigh20 && ind.donchianHigh20 > 0 ? ind.price / ind.donchianHigh20 : null;
    case "price_vs_donchian_low": return ind.donchianLow20 && ind.donchianLow20 > 0 ? ind.price / ind.donchianLow20 : null;
    case "ema20_vs_ema50": return ind.ema20 && ind.ema50 ? ind.ema20 - ind.ema50 : null;
    case "ema_alignment_bull": return ind.ema20 && ind.ema50 && ind.ema200 && ind.price
      ? (ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200 && ind.price > ind.ema20 ? 1 : 0) : null;
    case "ema_alignment_bear": return ind.ema20 && ind.ema50 && ind.ema200 && ind.price
      ? (ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200 && ind.price < ind.ema20 ? 1 : 0) : null;
    case "price_above_ema50": return ind.ema50 ? (ind.price > ind.ema50 ? 1 : 0) : null;
    case "rsi14": return ind.rsi14;
    case "volume_ratio": case "volume_ratio_3_20": return ind.volumeRatio;
    case "atr_percent": return ind.atrPercent;
    case "dist_from_ema50_pct": return ind.distFromEma50Pct;
    case "roc5": return ind.roc5;
    case "roc10": return ind.roc10;
    case "price_near_donchian_high": return ind.donchianHigh20 && ind.donchianHigh20 > 0 ? ind.price / ind.donchianHigh20 : null;
    case "price_near_donchian_low": return ind.donchianLow20 && ind.donchianLow20 > 0 ? ind.price / ind.donchianLow20 : null;
    case "vol_expansion_ratio": return null; // computed externally
    default: return null;
  }
}

// ── Backtester ──────────────────────────────────────────────

interface TradeState {
  side: TradeSide;
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop: number | null;
  holdingBars: number;
}

/**
 * Run a backtest on a candle array for a given hypothesis.
 * Strictly chronological — no lookahead.
 */
function runBacktest(
  candles: Candle[],
  hypothesis: Hypothesis,
  split: TestDataSplit,
): BacktestResult {
  const { exitLogic, riskAssumptions } = hypothesis;
  const trades: BacktestTrade[] = [];
  let activeTrade: TradeState | null = null;
  const equity = [1.0]; // start with normalized equity
  let currentEquity = 1.0;

  const minLookback = 50; // need at least 50 candles for indicators

  for (let i = minLookback; i < candles.length; i++) {
    const ind = computeBarIndicators(candles, i);
    const candle = candles[i];
    const regime = detectRegime(candles.slice(0, i + 1).map(c => c.close));

    // ── Manage active trade ──
    if (activeTrade) {
      activeTrade.holdingBars++;

      if (activeTrade.side === "long") {
        // Check stop loss
        if (candle.low <= activeTrade.stopLoss) {
          const exitPrice = activeTrade.stopLoss;
          const grossPnl = (exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice;
          const costs = (riskAssumptions.feesBps + riskAssumptions.slippageBps) / 10_000;
          const netPnl = grossPnl - costs;
          currentEquity *= (1 + netPnl * riskAssumptions.riskPerTrade / riskAssumptions.riskPerTrade);
          trades.push({
            entryTime: activeTrade.entryTime,
            exitTime: candle.time,
            entryPrice: activeTrade.entryPrice,
            exitPrice,
            side: "long",
            pnl: netPnl,
            pnlPercent: netPnl * 100,
            fees: riskAssumptions.feesBps / 10_000,
            slippage: riskAssumptions.slippageBps / 10_000,
            holdingBars: activeTrade.holdingBars,
            exitReason: "stop_loss",
            regime,
          });
          equity.push(currentEquity);
          activeTrade = null;
          continue;
        }

        // Check take profit
        if (candle.high >= activeTrade.takeProfit) {
          const exitPrice = activeTrade.takeProfit;
          const grossPnl = (exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice;
          const costs = (riskAssumptions.feesBps + riskAssumptions.slippageBps) / 10_000;
          const netPnl = grossPnl - costs;
          currentEquity *= (1 + netPnl * riskAssumptions.riskPerTrade / riskAssumptions.riskPerTrade);
          trades.push({
            entryTime: activeTrade.entryTime,
            exitTime: candle.time,
            entryPrice: activeTrade.entryPrice,
            exitPrice,
            side: "long",
            pnl: netPnl,
            pnlPercent: netPnl * 100,
            fees: riskAssumptions.feesBps / 10_000,
            slippage: riskAssumptions.slippageBps / 10_000,
            holdingBars: activeTrade.holdingBars,
            exitReason: "take_profit",
            regime,
          });
          equity.push(currentEquity);
          activeTrade = null;
          continue;
        }

        // Trailing stop update
        if (activeTrade.trailingStop) {
          const newTrail = candle.close - ind.atr14! * exitLogic.trailingStop!.trailPercent / 100 * 2;
          if (newTrail > activeTrade.trailingStop) activeTrade.trailingStop = newTrail;
          if (candle.low <= activeTrade.trailingStop) {
            const exitPrice = activeTrade.trailingStop;
            const grossPnl = (exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice;
            const costs = (riskAssumptions.feesBps + riskAssumptions.slippageBps) / 10_000;
            const netPnl = grossPnl - costs;
            currentEquity *= (1 + netPnl * riskAssumptions.riskPerTrade / riskAssumptions.riskPerTrade);
            trades.push({
              entryTime: activeTrade.entryTime,
              exitTime: candle.time,
              entryPrice: activeTrade.entryPrice,
              exitPrice,
              side: "long",
              pnl: netPnl,
              pnlPercent: netPnl * 100,
              fees: riskAssumptions.feesBps / 10_000,
              slippage: riskAssumptions.slippageBps / 10_000,
              holdingBars: activeTrade.holdingBars,
              exitReason: "trailing_stop",
              regime,
            });
            equity.push(currentEquity);
            activeTrade = null;
            continue;
          }
        }

        // Max hold exit
        if (activeTrade.holdingBars >= exitLogic.maxHoldBars) {
          const exitPrice = candle.close;
          const grossPnl = (exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice;
          const costs = (riskAssumptions.feesBps + riskAssumptions.slippageBps) / 10_000;
          const netPnl = grossPnl - costs;
          currentEquity *= (1 + netPnl * riskAssumptions.riskPerTrade / riskAssumptions.riskPerTrade);
          trades.push({
            entryTime: activeTrade.entryTime,
            exitTime: candle.time,
            entryPrice: activeTrade.entryPrice,
            exitPrice,
            side: "long",
            pnl: netPnl,
            pnlPercent: netPnl * 100,
            fees: riskAssumptions.feesBps / 10_000,
            slippage: riskAssumptions.slippageBps / 10_000,
            holdingBars: activeTrade.holdingBars,
            exitReason: "max_hold",
            regime,
          });
          equity.push(currentEquity);
          activeTrade = null;
          continue;
        }
      } else {
        // Short side — mirror logic
        if (candle.high >= activeTrade.stopLoss) {
          const exitPrice = activeTrade.stopLoss;
          const grossPnl = (activeTrade.entryPrice - exitPrice) / activeTrade.entryPrice;
          const costs = (riskAssumptions.feesBps + riskAssumptions.slippageBps) / 10_000;
          const netPnl = grossPnl - costs;
          currentEquity *= (1 + netPnl * riskAssumptions.riskPerTrade / riskAssumptions.riskPerTrade);
          trades.push({
            entryTime: activeTrade.entryTime, exitTime: candle.time,
            entryPrice: activeTrade.entryPrice, exitPrice, side: "short",
            pnl: netPnl, pnlPercent: netPnl * 100,
            fees: riskAssumptions.feesBps / 10_000, slippage: riskAssumptions.slippageBps / 10_000,
            holdingBars: activeTrade.holdingBars, exitReason: "stop_loss", regime,
          });
          equity.push(currentEquity);
          activeTrade = null;
          continue;
        }
        if (candle.low <= activeTrade.takeProfit) {
          const exitPrice = activeTrade.takeProfit;
          const grossPnl = (activeTrade.entryPrice - exitPrice) / activeTrade.entryPrice;
          const costs = (riskAssumptions.feesBps + riskAssumptions.slippageBps) / 10_000;
          const netPnl = grossPnl - costs;
          currentEquity *= (1 + netPnl * riskAssumptions.riskPerTrade / riskAssumptions.riskPerTrade);
          trades.push({
            entryTime: activeTrade.entryTime, exitTime: candle.time,
            entryPrice: activeTrade.entryPrice, exitPrice, side: "short",
            pnl: netPnl, pnlPercent: netPnl * 100,
            fees: riskAssumptions.feesBps / 10_000, slippage: riskAssumptions.slippageBps / 10_000,
            holdingBars: activeTrade.holdingBars, exitReason: "take_profit", regime,
          });
          equity.push(currentEquity);
          activeTrade = null;
          continue;
        }
        if (activeTrade.holdingBars >= exitLogic.maxHoldBars) {
          const exitPrice = candle.close;
          const grossPnl = (activeTrade.entryPrice - exitPrice) / activeTrade.entryPrice;
          const costs = (riskAssumptions.feesBps + riskAssumptions.slippageBps) / 10_000;
          const netPnl = grossPnl - costs;
          currentEquity *= (1 + netPnl * riskAssumptions.riskPerTrade / riskAssumptions.riskPerTrade);
          trades.push({
            entryTime: activeTrade.entryTime, exitTime: candle.time,
            entryPrice: activeTrade.entryPrice, exitPrice, side: "short",
            pnl: netPnl, pnlPercent: netPnl * 100,
            fees: riskAssumptions.feesBps / 10_000, slippage: riskAssumptions.slippageBps / 10_000,
            holdingBars: activeTrade.holdingBars, exitReason: "max_hold", regime,
          });
          equity.push(currentEquity);
          activeTrade = null;
          continue;
        }
      }
    }

    // ── Check for new entry ──
    if (!activeTrade) {
      const requiredCond = hypothesis.entryLogic.conditions.filter(c => c.required);
      const optionalCond = hypothesis.entryLogic.conditions.filter(c => !c.required);

      const requiredPass = requiredCond.every(c => evaluateCondition(c, ind));
      if (!requiredPass) continue;

      const optionalPass = optionalCond.filter(c => evaluateCondition(c, ind)).length;
      if (optionalPass < hypothesis.entryLogic.minOptionalConditions) continue;

      // Entry triggered — compute levels
      const price = ind.price;
      const atrVal = ind.atr14 ?? price * 0.01;

      let stopDist: number, tpDist: number;
      if (exitLogic.stopLoss.type === "atr") {
        stopDist = atrVal * exitLogic.stopLoss.value;
      } else if (exitLogic.stopLoss.type === "percent") {
        stopDist = price * exitLogic.stopLoss.value / 100;
      } else {
        stopDist = exitLogic.stopLoss.value;
      }

      if (exitLogic.takeProfit.type === "atr") {
        tpDist = atrVal * exitLogic.takeProfit.value;
      } else if (exitLogic.takeProfit.type === "rr_ratio") {
        tpDist = stopDist * exitLogic.takeProfit.value;
      } else if (exitLogic.takeProfit.type === "percent") {
        tpDist = price * exitLogic.takeProfit.value / 100;
      } else {
        tpDist = exitLogic.takeProfit.value;
      }

      const side = hypothesis.side;
      const entryPrice = price;
      const stopLoss = side === "long" ? price - stopDist : price + stopDist;
      const takeProfit = side === "long" ? price + tpDist : price - tpDist;

      activeTrade = {
        side,
        entryTime: candle.time,
        entryPrice,
        stopLoss,
        takeProfit,
        trailingStop: null,
        holdingBars: 0,
      };

      // Activate trailing stop
      if (exitLogic.trailingStop?.enabled) {
        const activationDist = stopDist * exitLogic.trailingStop.activationRR;
        activeTrade.trailingStop = side === "long"
          ? entryPrice + activationDist - stopDist * exitLogic.trailingStop.trailPercent / 100 * 2
          : entryPrice - activationDist + stopDist * exitLogic.trailingStop.trailPercent / 100 * 2;
      }
    }
  }

  // ── Compute performance metrics ──
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const totalReturn = currentEquity - 1.0;
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const grossWins = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
  const expectancy = trades.length > 0 ? totalReturn / trades.length : 0;

  // Max drawdown
  let peak = 1.0;
  let maxDd = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    const dd = (peak - e) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  // Sharpe (simplified)
  const returns = trades.map(t => t.pnl);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const returnStd = returns.length > 1 ? stddev(returns) : 0;
  const sharpe = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0;

  // Sortino
  const downsideReturns = returns.filter(r => r < 0);
  const downsideStd = downsideReturns.length > 1 ? stddev(downsideReturns) : returnStd;
  const sortino = downsideStd > 0 ? (avgReturn / downsideStd) * Math.sqrt(252) : 0;

  // Monthly returns
  const monthlyReturns: { month: string; return: number; regime: MarketRegime }[] = [];
  const monthMap = new Map<string, number[]>();
  for (const t of trades) {
    const month = new Date(t.entryTime).toISOString().slice(0, 7);
    if (!monthMap.has(month)) monthMap.set(month, []);
    monthMap.get(month)!.push(t.pnl);
  }
  for (const [month, pnls] of monthMap) {
    monthlyReturns.push({
      month,
      return: pnls.reduce((a, b) => a + b, 0),
      regime: detectRegime(pnls.map((_, i) => 1 + i)), // simplified
    });
  }

  // Average holding bars
  const avgHolding = trades.length > 0 ? trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length : 0;
  const totalFees = trades.reduce((s, t) => s + t.fees, 0);
  const totalSlippage = trades.reduce((s, t) => s + t.slippage, 0);

  return {
    split,
    startTime: candles[0]?.time ?? 0,
    endTime: candles[candles.length - 1]?.time ?? 0,
    candleCount: candles.length,
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate,
    totalReturn,
    annualizedReturn: totalReturn * (365 * 24 * 60) / Math.max(1, candles.length * 15), // rough annualization
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    profitFactor,
    expectancy,
    maxDrawdown: maxDd,
    avgWin,
    avgLoss,
    bestTrade: trades.length > 0 ? Math.max(...trades.map(t => t.pnl)) : 0,
    worstTrade: trades.length > 0 ? Math.min(...trades.map(t => t.pnl)) : 0,
    avgHoldingBars: avgHolding,
    totalFees,
    totalSlippage,
    equityCurve: equity,
    monthlyReturns,
    trades,
  };
}

// ── Walk-Forward Testing ────────────────────────────────────

function runWalkForward(
  candles: Candle[],
  hypothesis: Hypothesis,
  windowCandles: number,
  stepCandles: number,
): WalkForwardResult {
  const windows: WalkForwardWindow[] = [];
  let windowIndex = 0;

  for (let start = 0; start + windowCandles * 2 <= candles.length; start += stepCandles) {
    const trainEnd = start + windowCandles;
    const oosEnd = Math.min(trainEnd + windowCandles, candles.length);

    const trainCandles = candles.slice(start, trainEnd);
    const oosCandles = candles.slice(trainEnd, oosEnd);

    if (trainCandles.length < 50 || oosCandles.length < 20) continue;

    const training = runBacktest(trainCandles, hypothesis, "training");
    const outOfSample = runBacktest(oosCandles, hypothesis, "out_of_sample");

    windows.push({
      windowIndex,
      trainingStart: trainCandles[0]?.time ?? 0,
      trainingEnd: trainCandles[trainCandles.length - 1]?.time ?? 0,
      oosStart: oosCandles[0]?.time ?? 0,
      oosEnd: oosCandles[oosCandles.length - 1]?.time ?? 0,
      training,
      outOfSample,
    });

    windowIndex++;
  }

  // Aggregate OOS
  const allOOS = windows.map(w => w.outOfSample);
  const aggSharpe = allOOS.length > 0 ? allOOS.reduce((s, r) => s + r.sharpeRatio, 0) / allOOS.length : 0;
  const aggWinRate = allOOS.length > 0 ? allOOS.reduce((s, r) => s + r.winRate, 0) / allOOS.length : 0;
  const aggPF = allOOS.length > 0 ? allOOS.reduce((s, r) => s + r.profitFactor, 0) / allOOS.length : 0;
  const aggExp = allOOS.length > 0 ? allOOS.reduce((s, r) => s + r.expectancy, 0) / allOOS.length : 0;
  const aggMaxDd = allOOS.length > 0 ? Math.max(...allOOS.map(r => r.maxDrawdown)) : 0;
  const aggTrades = allOOS.reduce((s, r) => s + r.totalTrades, 0);

  // Degradation ratio: avg OOS Sharpe / avg training Sharpe
  const avgTrainSharpe = windows.length > 0 ? windows.reduce((s, w) => s + w.training.sharpeRatio, 0) / windows.length : 0;
  const degradation = avgTrainSharpe > 0 ? aggSharpe / avgTrainSharpe : 0;

  return {
    windowCount: windows.length,
    windows,
    aggregateOOS: {
      sharpe: aggSharpe,
      winRate: aggWinRate,
      profitFactor: aggPF,
      expectancy: aggExp,
      maxDrawdown: aggMaxDd,
      totalTrades: aggTrades,
    },
    degradationRatio: degradation,
  };
}

// ── Sensitivity Testing ─────────────────────────────────────

function runSensitivityTests(
  candles: Candle[],
  hypothesis: Hypothesis,
  variations: number,
): SensitivityResult[] {
  const results: SensitivityResult[] = [];

  // Test stop loss multiplier sensitivity
  const stopMultipliers = [1.0, 1.5, 2.0, 2.5, 3.0];
  const stopResults = stopMultipliers.map(mult => {
    const modified = { ...hypothesis, exitLogic: { ...hypothesis.exitLogic, stopLoss: { ...hypothesis.exitLogic.stopLoss, value: mult } } };
    const result = runBacktest(candles, modified, "training");
    return { value: mult, sharpe: result.sharpeRatio, winRate: result.winRate, expectancy: result.expectancy, maxDrawdown: result.maxDrawdown };
  });
  results.push({
    parameter: "stopLossMultiplier",
    baseValue: hypothesis.exitLogic.stopLoss.value,
    testedValues: stopMultipliers,
    results: stopResults,
    isStable: stddev(stopResults.map(r => r.sharpe)) < 1.0,
    maxPerformanceDrop: Math.max(...stopResults.map(r => r.sharpe)) - Math.min(...stopResults.map(r => r.sharpe)),
  });

  // Test take profit R:R sensitivity
  const rrValues = [1.5, 2.0, 2.5, 3.0, 4.0];
  const rrResults = rrValues.map(rr => {
    const modified = { ...hypothesis, exitLogic: { ...hypothesis.exitLogic, takeProfit: { ...hypothesis.exitLogic.takeProfit, value: rr } } };
    const result = runBacktest(candles, modified, "training");
    return { value: rr, sharpe: result.sharpeRatio, winRate: result.winRate, expectancy: result.expectancy, maxDrawdown: result.maxDrawdown };
  });
  results.push({
    parameter: "takeProfitRR",
    baseValue: hypothesis.exitLogic.takeProfit.value,
    testedValues: rrValues,
    results: rrResults,
    isStable: stddev(rrResults.map(r => r.sharpe)) < 1.0,
    maxPerformanceDrop: Math.max(...rrResults.map(r => r.sharpe)) - Math.min(...rrResults.map(r => r.sharpe)),
  });

  // Test max hold bars sensitivity
  const holdBars = [12, 24, 36, 48, 72];
  const holdResults = holdBars.map(h => {
    const modified = { ...hypothesis, exitLogic: { ...hypothesis.exitLogic, maxHoldBars: h } };
    const result = runBacktest(candles, modified, "training");
    return { value: h, sharpe: result.sharpeRatio, winRate: result.winRate, expectancy: result.expectancy, maxDrawdown: result.maxDrawdown };
  });
  results.push({
    parameter: "maxHoldBars",
    baseValue: hypothesis.exitLogic.maxHoldBars,
    testedValues: holdBars,
    results: holdResults,
    isStable: stddev(holdResults.map(r => r.sharpe)) < 1.5,
    maxPerformanceDrop: Math.max(...holdResults.map(r => r.sharpe)) - Math.min(...holdResults.map(r => r.sharpe)),
  });

  return results;
}

// ── Public API ──────────────────────────────────────────────

/**
 * Run a complete test suite for a hypothesis.
 * Splits data chronologically into train/validation/OOS,
 * runs walk-forward, sensitivity analysis, and returns all results.
 */
export function testHypothesis(
  candles: Candle[],
  hypothesis: Hypothesis,
  config?: {
    trainingFraction?: number;
    validationFraction?: number;
    outOfSampleFraction?: number;
    walkForwardWindowCandles?: number;
    walkForwardStepCandles?: number;
    sensitivityVariations?: number;
  },
): HypothesisTestResult {
  const trainFrac = config?.trainingFraction ?? 0.6;
  const valFrac = config?.validationFraction ?? 0.2;
  const oosFrac = config?.outOfSampleFraction ?? 0.2;
  const wfWindow = config?.walkForwardWindowCandles ?? 200;
  const wfStep = config?.walkForwardStepCandles ?? 100;
  const sensVars = config?.sensitivityVariations ?? 5;

  const total = candles.length;
  const trainEnd = Math.floor(total * trainFrac);
  const valEnd = Math.floor(total * (trainFrac + valFrac));

  const trainCandles = candles.slice(0, trainEnd);
  const valCandles = candles.slice(trainEnd, valEnd);
  const oosCandles = candles.slice(valEnd);

  const startTime = Date.now();

  const training = runBacktest(trainCandles, hypothesis, "training");
  const validation = runBacktest(valCandles, hypothesis, "validation");
  const outOfSample = runBacktest(oosCandles, hypothesis, "out_of_sample");
  const walkForward = runWalkForward(candles, hypothesis, wfWindow, wfStep);
  const sensitivity = runSensitivityTests(trainCandles, hypothesis, sensVars);

  return {
    hypothesisId: hypothesis.id,
    hypothesisVersion: hypothesis.version,
    training,
    validation,
    outOfSample,
    walkForward,
    sensitivity,
    validationResult: null as unknown as ValidationResult, // filled by validator
    completedAt: Date.now(),
    computationTimeMs: Date.now() - startTime,
  };
}

// Re-export ValidationResult type for the test result
import type { ValidationResult } from "./types";

export { runBacktest, runWalkForward, runSensitivityTests };
