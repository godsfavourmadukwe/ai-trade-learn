// ============================================================
// MARKET REGIME INTELLIGENCE — Feature Extraction
//
// Computes measurable features from OHLCV candle data for
// regime classification. All features use only past data —
// no lookahead bias.
// ============================================================

import type { Candle } from "@/lib/market/types";
import type { RegimeFeatures } from "./types";

// ── Utility Functions ──────────────────────────────────────

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i];
  }
  return sum / period;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function trueRange(candles: Candle[], i: number): number {
  if (i === 0) return candles[i].high - candles[i].low;
  const high = candles[i].high;
  const low = candles[i].low;
  const prevClose = candles[i - 1].close;
  return Math.max(
    high - low,
    Math.abs(high - prevClose),
    Math.abs(low - prevClose),
  );
}

// ── Feature Extraction ─────────────────────────────────────

/**
 * Extract regime features from candle data.
 * Requires at least 30 candles for reliable classification.
 */
export function extractRegimeFeatures(
  candles15m: Candle[],
  candles1h: Candle[],
  livePrice: number,
  priceHistory: number[],
): RegimeFeatures | null {
  if (candles15m.length < 20) return null;

  const closes = candles15m.map(c => c.close);
  const highs = candles15m.map(c => c.high);
  const lows = candles15m.map(c => c.low);
  const volumes = candles15m.map(c => c.volume);

  const n = closes.length;
  const price = livePrice > 0 ? livePrice : closes[n - 1];

  // ── ADX / Trend Strength ──────────────────────────────

  const { adx, diSpread, trendDirection, trendStrength } = computeADX(candles15m, 14);

  // ── Volatility ────────────────────────────────────────

  const atrVal = computeATR(candles15m, 14);
  const atrPercent = atrVal && price > 0 ? atrVal / price : 0;
  const realizedVol = computeRealizedVolatility(closes, 20);
  const bbWidth = computeBollingerBandWidth(closes, 20);
  const volatilityLevel = computeVolatilityLevel(atrPercent, realizedVol, closes);

  // ── Momentum ──────────────────────────────────────────

  const momentum = computeMomentum(closes, 10);
  const priceAcceleration = computePriceAcceleration(closes, 10);
  const rsi = computeRSI(closes, 14);

  // ── Volume ────────────────────────────────────────────

  const volumeRatio = computeVolumeRatio(volumes, 20);
  const obvSlope = computeOBVSlope(closes, volumes, 20);
  const volumeTrend = computeVolumeTrend(volumes, 20);

  // ── Price Structure ───────────────────────────────────

  const { donchianPosition, bbPosition } = computePricePosition(
    closes, highs, lows, 20,
  );
  const { higherHighs, higherLows, lowerHighs, lowerLows } = computeSwingStructure(
    candles15m, 20,
  );

  // ── Mean Reversion & Breakout ─────────────────────────

  const meanReversionScore = computeMeanReversionScore(closes, rsi, bbPosition, 20);
  const breakoutProbability = computeBreakoutProbability(
    closes, highs, lows, volumeRatio, atrPercent, 20,
  );

  return {
    trendStrength,
    trendDirection,
    adx,
    diSpread,
    volatilityLevel,
    atrPercent,
    realizedVol,
    bbWidth,
    momentum,
    priceAcceleration,
    rsi,
    obvSlope,
    volumeRatio,
    volumeTrend,
    donchianPosition,
    bbPosition,
    higherHighs,
    higherLows,
    lowerHighs,
    lowerLows,
    candleCount: n,
    meanReversionScore,
    breakoutProbability,
  };
}

// ── ADX Computation ────────────────────────────────────────

function computeADX(
  candles: Candle[],
  period: number,
): { adx: number; diSpread: number; trendDirection: number; trendStrength: number } {
  if (candles.length < period + 1) {
    return { adx: 0, diSpread: 0, trendDirection: 0, trendStrength: 0 };
  }

  const trueRanges: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    trueRanges.push(trueRange(candles, i));

    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;

    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Smoothed averages
  let atrSum = 0, plusDMSum = 0, minusDMSum = 0;
  for (let i = 0; i < period; i++) {
    atrSum += trueRanges[i];
    plusDMSum += plusDMs[i];
    minusDMSum += minusDMs[i];
  }

  let atrSmooth = atrSum / period;
  let plusDMSmooth = plusDMSum / period;
  let minusDMSmooth = minusDMSum / period;

  const dxValues: number[] = [];

  for (let i = period; i < trueRanges.length; i++) {
    atrSmooth = (atrSmooth * (period - 1) + trueRanges[i]) / period;
    plusDMSmooth = (plusDMSmooth * (period - 1) + plusDMs[i]) / period;
    minusDMSmooth = (minusDMSmooth * (period - 1) + minusDMs[i]) / period;

    if (atrSmooth === 0) {
      dxValues.push(0);
      continue;
    }

    const plusDI = (plusDMSmooth / atrSmooth) * 100;
    const minusDI = (minusDMSmooth / atrSmooth) * 100;
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    dxValues.push(dx);
  }

  // ADX = smoothed DX
  let adx = dxValues.length >= period
    ? dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period
    : dxValues.length > 0
      ? dxValues.reduce((a, b) => a + b, 0) / dxValues.length
      : 0;

  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }

  // Direction and strength
  const finalPlusDI = atrSmooth > 0 ? (plusDMSmooth / atrSmooth) * 100 : 0;
  const finalMinusDI = atrSmooth > 0 ? (minusDMSmooth / atrSmooth) * 100 : 0;
  const diSpread = finalPlusDI - finalMinusDI;
  const trendDirection = diSpread > 0 ? 1 : diSpread < 0 ? -1 : 0;
  const trendStrength = Math.min(1, adx / 60); // normalize ADX to 0-1

  return { adx, diSpread, trendDirection, trendStrength };
}

// ── ATR ────────────────────────────────────────────────────

function computeATR(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;
  let atr = 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(trueRange(candles, i));
  }
  if (trs.length < period) return 0;
  atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

// ── Realized Volatility ────────────────────────────────────

function computeRealizedVolatility(closes: number[], period: number): number {
  if (closes.length < period + 1) return 0;
  const returns: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] !== 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }
  return stddev(returns);
}

// ── Bollinger Band Width ───────────────────────────────────

function computeBollingerBandWidth(closes: number[], period: number): number {
  const mean = sma(closes, period);
  if (mean === null || mean === 0) return 0;
  const recentCloses = closes.slice(-period);
  const std = stddev(recentCloses);
  return (std * 2) / mean; // normalized BB width
}

// ── Volatility Level ───────────────────────────────────────

function computeVolatilityLevel(
  atrPercent: number,
  realizedVol: number,
  closes: number[],
): number {
  // Compute ATR percentile over available data
  if (closes.length < 50) return 0.5;

  const windowSize = 14;
  const atrValues: number[] = [];
  for (let i = windowSize; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - windowSize + 1; j <= i; j++) {
      sum += Math.abs(closes[j] - closes[j - 1]);
    }
    atrValues.push(sum / windowSize);
  }

  if (atrValues.length === 0) return 0.5;

  const currentAtr = atrValues[atrValues.length - 1];
  const sortedAtr = [...atrValues].sort((a, b) => a - b);
  const rank = sortedAtr.indexOf(currentAtr);
  const percentile = rank / sortedAtr.length;

  return Math.max(0, Math.min(1, percentile));
}

// ── Momentum ───────────────────────────────────────────────

function computeMomentum(closes: number[], period: number): number {
  if (closes.length < period + 1) return 0;
  return (closes[closes.length - 1] - closes[closes.length - 1 - period]) /
    closes[closes.length - 1 - period];
}

function computePriceAcceleration(closes: number[], period: number): number {
  if (closes.length < period * 2 + 1) return 0;
  const recentMom = (closes[closes.length - 1] - closes[closes.length - 1 - period]) /
    closes[closes.length - 1 - period];
  const prevMom = (closes[closes.length - 1 - period] - closes[closes.length - 1 - period * 2]) /
    closes[closes.length - 1 - period * 2];
  return recentMom - prevMom;
}

function computeRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

// ── Volume ─────────────────────────────────────────────────

function computeVolumeRatio(volumes: number[], period: number): number {
  const avg = sma(volumes, period);
  if (!avg || avg === 0) return 1;
  return volumes[volumes.length - 1] / avg;
}

function computeOBVSlope(closes: number[], volumes: number[], period: number): number {
  if (closes.length < period + 1) return 0;

  const obv: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) {
      obv.push(obv[obv.length - 1] + volumes[i]);
    } else if (closes[i] < closes[i - 1]) {
      obv.push(obv[obv.length - 1] - volumes[i]);
    } else {
      obv.push(obv[obv.length - 1]);
    }
  }

  // Linear regression slope of recent OBV
  const recentOBV = obv.slice(-period);
  if (recentOBV.length < 5) return 0;

  const meanX = (recentOBV.length - 1) / 2;
  const meanY = recentOBV.reduce((a, b) => a + b, 0) / recentOBV.length;
  let num = 0, den = 0;
  for (let i = 0; i < recentOBV.length; i++) {
    num += (i - meanX) * (recentOBV[i] - meanY);
    den += (i - meanX) ** 2;
  }

  const slope = den !== 0 ? num / den : 0;
  // Normalize: divide by mean volume to get relative slope
  const avgVol = meanY !== 0 ? Math.abs(meanY) : 1;
  return slope / avgVol;
}

function computeVolumeTrend(volumes: number[], period: number): number {
  if (volumes.length < period) return 0;
  const recent = volumes.slice(-period);
  const older = volumes.slice(-period * 2, -period);
  if (older.length === 0) return 0;
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  return olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
}

// ── Price Position ─────────────────────────────────────────

function computePricePosition(
  closes: number[],
  highs: number[],
  lows: number[],
  period: number,
): { donchianPosition: number; bbPosition: number } {
  if (closes.length < period) return { donchianPosition: 0.5, bbPosition: 0.5 };

  const recentCloses = closes.slice(-period);
  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);

  // Donchian position
  const high = Math.max(...recentHighs);
  const low = Math.min(...recentLows);
  const donchianRange = high - low;
  const donchianPosition = donchianRange > 0
    ? (closes[closes.length - 1] - low) / donchianRange
    : 0.5;

  // Bollinger position
  const mean = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
  const std = stddev(recentCloses);
  const bbPosition = std > 0
    ? (closes[closes.length - 1] - mean) / (2 * std) + 0.5
    : 0.5;

  return {
    donchianPosition: Math.max(0, Math.min(1, donchianPosition)),
    bbPosition: Math.max(0, Math.min(1, bbPosition)),
  };
}

// ── Swing Structure ────────────────────────────────────────

function computeSwingStructure(
  candles: Candle[],
  lookback: number,
): { higherHighs: number; higherLows: number; lowerHighs: number; lowerLows: number } {
  const n = candles.length;
  const start = Math.max(0, n - lookback);
  let hh = 0, hl = 0, lh = 0, ll = 0;

  // Find local highs and lows using 3-bar pivots
  const swings: { type: "high" | "low"; price: number; index: number }[] = [];

  for (let i = start + 2; i < n; i++) {
    if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i - 2].high) {
      swings.push({ type: "high", price: candles[i].high, index: i });
    }
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i - 2].low) {
      swings.push({ type: "low", price: candles[i].low, index: i });
    }
  }

  // Count higher highs/lows and lower highs/lows
  const recentHighs = swings.filter(s => s.type === "high");
  const recentLows = swings.filter(s => s.type === "low");

  for (let i = 1; i < recentHighs.length; i++) {
    if (recentHighs[i].price > recentHighs[i - 1].price) hh++;
    else lh++;
  }
  for (let i = 1; i < recentLows.length; i++) {
    if (recentLows[i].price > recentLows[i - 1].price) hl++;
    else ll++;
  }

  return { higherHighs: hh, higherLows: hl, lowerHighs: lh, lowerLows: ll };
}

// ── Mean Reversion & Breakout Scores ───────────────────────

function computeMeanReversionScore(
  closes: number[],
  rsi: number,
  bbPosition: number,
  period: number,
): number {
  let score = 0;

  // RSI extreme = high mean reversion probability
  if (rsi > 70 || rsi < 30) score += 0.3;
  if (rsi > 80 || rsi < 20) score += 0.2;

  // Price at Bollinger extremes = high mean reversion
  if (bbPosition > 0.9 || bbPosition < 0.1) score += 0.3;
  if (bbPosition > 0.95 || bbPosition < 0.05) score += 0.2;

  return Math.min(1, score);
}

function computeBreakoutProbability(
  closes: number[],
  highs: number[],
  lows: number[],
  volumeRatio: number,
  atrPercent: number,
  period: number,
): number {
  if (closes.length < period) return 0;

  let score = 0;

  // Bollinger squeeze = high breakout probability
  const recentCloses = closes.slice(-period);
  const std = stddev(recentCloses);
  const mean = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
  const bbWidth = mean > 0 ? (std * 2) / mean : 0;
  if (bbWidth < 0.02) score += 0.3;
  if (bbWidth < 0.01) score += 0.2;

  // Low volatility = high breakout probability
  if (atrPercent < 0.005) score += 0.2;

  // Price near Donchian boundary
  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const highest = Math.max(...recentHighs);
  const lowest = Math.min(...recentLows);
  const currentPrice = closes[closes.length - 1];

  const distToHigh = highest > 0 ? (highest - currentPrice) / highest : 0;
  const distToLow = lowest > 0 ? (currentPrice - lowest) / lowest : 0;

  if (distToHigh < 0.005 || distToLow < 0.005) score += 0.2;

  // High volume = breakout confirmation
  if (volumeRatio > 1.5) score += 0.1;
  if (volumeRatio > 2.0) score += 0.1;

  return Math.min(1, score);
}
