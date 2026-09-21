// ============================================================
// STOCK MARKET INTELLIGENCE — Stock AI Analyst
//
// Analyzes a stock from multiple perspectives:
//   - Price action & technical indicators
//   - Trend & momentum
//   - Volatility & risk
//   - Volume analysis
//   - Support/resistance levels
//   - Fundamentals
//   - Market regime
//   - Sector context
//
// Produces structured analysis with evidence, risks,
// invalidation conditions, and confidence scoring.
// NEVER fabricates data — uses only what's available.
// ============================================================

import type { Candle } from "@/lib/market/types";
import type { StockQuote, FundamentalData } from "./data-engine";

// ── Types ─────────────────────────────────────────────────

export type AnalysisDirection = "bullish" | "bearish" | "neutral";

export interface StockAnalysis {
  symbol: string;
  direction: AnalysisDirection;
  confidence: number;
  summary: string;
  sections: AnalysisSection[];
  risks: RiskItem[];
  invalidationConditions: string[];
  keyLevels: KeyLevels;
  timestamp: number;
}

export interface AnalysisSection {
  title: string;
  direction: AnalysisDirection;
  confidence: number;
  findings: Finding[];
  metrics: Record<string, number | string>;
}

export interface Finding {
  type: "supporting" | "contradicting" | "neutral";
  label: string;
  value: string;
  detail: string;
}

export interface RiskItem {
  severity: "high" | "medium" | "low";
  label: string;
  description: string;
}

export interface KeyLevels {
  support: number[];
  resistance: number[];
  stopLoss: number | null;
  takeProfit: number | null;
  pivot: number | null;
}

// ── Main Analysis Function ────────────────────────────────

export function analyzeStock(
  quote: StockQuote,
  candles: Candle[],
  fundamentals: FundamentalData | null,
  sectorPerformance?: number,
): StockAnalysis {
  const sections: AnalysisSection[] = [];
  const risks: RiskItem[] = [];
  const invalidationConditions: string[] = [];

  let bullishScore = 0;
  let bearishScore = 0;
  let totalWeight = 0;

  // 1. Price Action & Technical Analysis
  const technical = analyzeTechnical(candles, quote);
  sections.push(technical.section);
  bullishScore += technical.bullish * technical.section.confidence;
  bearishScore += technical.bearish * technical.section.confidence;
  totalWeight += technical.section.confidence;

  // 2. Trend Analysis
  const trend = analyzeTrend(candles, quote);
  sections.push(trend.section);
  bullishScore += trend.bullish * trend.section.confidence;
  bearishScore += trend.bearish * trend.section.confidence;
  totalWeight += trend.section.confidence;

  // 3. Momentum
  const momentum = analyzeMomentum(candles, quote);
  sections.push(momentum.section);
  bullishScore += momentum.bullish * momentum.section.confidence;
  bearishScore += momentum.bearish * momentum.section.confidence;
  totalWeight += momentum.section.confidence;

  // 4. Volatility & Risk
  const volatility = analyzeVolatility(candles, quote);
  sections.push(volatility.section);
  if (volatility.risks) risks.push(...volatility.risks);

  // 5. Volume Analysis
  const volume = analyzeVolume(candles, quote);
  sections.push(volume.section);
  bullishScore += volume.bullish * volume.section.confidence;
  bearishScore += volume.bearish * volume.section.confidence;
  totalWeight += volume.section.confidence;

  // 6. Support/Resistance
  const sr = analyzeSupportResistance(candles, quote);
  sections.push(sr.section);
  const srSupportLevels = sr.supportLevels;
  const srResistanceLevels = sr.resistanceLevels;

  // 7. Fundamentals (if available)
  if (fundamentals) {
    const fund = analyzeFundamentals(fundamentals, quote);
    sections.push(fund.section);
    bullishScore += fund.bullish * fund.section.confidence;
    bearishScore += fund.bearish * fund.section.confidence;
    totalWeight += fund.section.confidence;
  }

  // 8. Valuation
  const valuation = analyzeValuation(quote, fundamentals);
  sections.push(valuation.section);
  bullishScore += valuation.bullish * valuation.section.confidence;
  bearishScore += valuation.bearish * valuation.section.confidence;
  totalWeight += valuation.section.confidence;

  // Compute overall direction and confidence
  const netScore = totalWeight > 0 ? (bullishScore - bearishScore) / totalWeight : 0;
  const direction: AnalysisDirection = netScore > 0.15 ? "bullish" : netScore < -0.15 ? "bearish" : "neutral";
  const confidence = Math.min(0.85, Math.abs(netScore) * 0.6 + 0.2);

  // Build key levels
  const keyLevels = computeKeyLevels(candles, quote, srSupportLevels, srResistanceLevels);

  // Add general risks
  if (quote.changePercent < -5) {
    risks.push({ severity: "high", label: "Sharp decline", description: `Stock is down ${Math.abs(quote.changePercent).toFixed(1)}% — momentum may continue lower.` });
  }
  if (quote.price > quote.week52High * 0.95 && quote.week52High > 0) {
    risks.push({ severity: "medium", label: "Near 52-week high", description: "Stock is near its 52-week high. Potential resistance." });
  }
  if (quote.beta && quote.beta > 1.5) {
    risks.push({ severity: "medium", label: "High beta", description: `Beta of ${quote.beta.toFixed(2)} indicates higher volatility than the market.` });
  }

  // Invalidation conditions
  if (direction === "bullish") {
    invalidationConditions.push(`Break below $${keyLevels.support[0]?.toFixed(2) ?? "N/A"}`);
    invalidationConditions.push("RSI drops below 30 (oversold momentum shift)");
    invalidationConditions.push("Volume dries up on any bounce attempt");
  } else if (direction === "bearish") {
    invalidationConditions.push(`Break above $${keyLevels.resistance[0]?.toFixed(2) ?? "N/A"}`);
    invalidationConditions.push("RSI rises above 70 (overbought reversal)");
    invalidationConditions.push("Volume surge on a green candle");
  } else {
    invalidationConditions.push("Breakout above recent resistance with volume");
    invalidationConditions.push("Breakdown below recent support with volume");
  }

  // Generate summary
  const summary = generateSummary(quote, direction, confidence, sections, risks);

  return {
    symbol: quote.symbol,
    direction,
    confidence,
    summary,
    sections,
    risks,
    invalidationConditions,
    keyLevels,
    timestamp: Date.now(),
  };
}

// ── Technical Analysis ────────────────────────────────────

function analyzeTechnical(candles: Candle[], quote: StockQuote) {
  const findings: Finding[] = [];
  const metrics: Record<string, number | string> = {};
  let bullish = 0;
  let bearish = 0;

  if (candles.length < 20) {      return {
        section: { title: "Technical Indicators", direction: "neutral" as const, confidence: 0.2, findings: [{ type: "neutral" as const, label: "Insufficient data", value: `${candles.length} candles`, detail: "Need at least 20 candles for technical analysis." }], metrics },
        bullish: 0, bearish: 0,
      };
  }

  const closes = candles.map((c) => c.close);

  // RSI
  const rsi = computeRSI(closes, 14);
  metrics.rsi14 = rsi;
  if (rsi > 70) {
    findings.push({ type: "contradicting", label: "RSI Overbought", value: rsi.toFixed(1), detail: "RSI above 70 indicates overbought conditions." });
    bearish += 1;
  } else if (rsi < 30) {
    findings.push({ type: "supporting", label: "RSI Oversold", value: rsi.toFixed(1), detail: "RSI below 30 indicates oversold conditions — potential bounce." });
    bullish += 1;
  } else if (rsi > 50) {
    findings.push({ type: "supporting", label: "RSI Bullish", value: rsi.toFixed(1), detail: "RSI above 50 indicates bullish momentum." });
    bullish += 0.5;
  } else {
    findings.push({ type: "contradicting", label: "RSI Bearish", value: rsi.toFixed(1), detail: "RSI below 50 indicates bearish momentum." });
    bearish += 0.5;
  }

  // MACD
  const macd = computeMACD(closes);
  metrics.macd = macd.macd;
  metrics.macdSignal = macd.signal;
  metrics.macdHistogram = macd.histogram;
  if (macd.histogram > 0) {
    findings.push({ type: "supporting", label: "MACD Bullish", value: macd.histogram.toFixed(4), detail: "MACD above signal line — bullish momentum." });
    bullish += 0.8;
  } else {
    findings.push({ type: "contradicting", label: "MACD Bearish", value: macd.histogram.toFixed(4), detail: "MACD below signal line — bearish momentum." });
    bearish += 0.8;
  }

  // Bollinger Bands
  const bb = computeBollingerBands(closes, 20);
  const bbPosition = bb.upper > bb.lower ? (quote.price - bb.lower) / (bb.upper - bb.lower) : 0.5;
  metrics.bbUpper = bb.upper;
  metrics.bbLower = bb.lower;
  metrics.bbPosition = bbPosition;
  if (bbPosition > 0.9) {
    findings.push({ type: "contradicting", label: "Near Upper BB", value: `${(bbPosition * 100).toFixed(0)}%`, detail: "Price near upper Bollinger Band — potential resistance." });
    bearish += 0.3;
  } else if (bbPosition < 0.1) {
    findings.push({ type: "supporting", label: "Near Lower BB", value: `${(bbPosition * 100).toFixed(0)}%`, detail: "Price near lower Bollinger Band — potential support." });
    bullish += 0.3;
  }

  const netBullBear = bullish - bearish;
  const direction = netBullBear > 0.5 ? "bullish" as const : netBullBear < -0.5 ? "bearish" as const : "neutral" as const;

  return {
    section: { title: "Technical Indicators", direction, confidence: Math.min(0.8, 0.3 + Math.abs(netBullBear) * 0.15), findings, metrics },
    bullish,
    bearish,
  };
}

// ── Trend Analysis ────────────────────────────────────────

function analyzeTrend(candles: Candle[], quote: StockQuote) {
  const findings: Finding[] = [];
  const metrics: Record<string, number | string> = {};
  let bullish = 0;
  let bearish = 0;

  if (candles.length < 50) {
    return {
      section: { title: "Trend Analysis", direction: "neutral" as const, confidence: 0.2, findings: [{ type: "neutral" as const, label: "Insufficient data", value: `${candles.length} candles`, detail: "Need 50+ candles for trend analysis." }], metrics },
      bullish: 0, bearish: 0,
    };
  }

  const closes = candles.map((c) => c.close);

  // EMAs
  const ema20Arr = computeEMA(closes, 20);
  const ema50Arr = computeEMA(closes, 50);
  const ema20 = ema20Arr[ema20Arr.length - 1] ?? closes[closes.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1] ?? closes[closes.length - 1];
  const sma200 = closes.length >= 200 ? computeSMA(closes, 200) : computeSMA(closes, closes.length);
  metrics.ema20 = ema20;
  metrics.ema50 = ema50;
  metrics.sma200 = sma200;

  // EMA alignment
  if (ema20 > ema50 && ema50 > sma200) {
    findings.push({ type: "supporting", label: "Bullish EMA Stack", value: `EMA20 > EMA50 > SMA200`, detail: "All moving averages aligned bullish." });
    bullish += 2;
  } else if (ema20 < ema50 && ema50 < sma200) {
    findings.push({ type: "contradicting", label: "Bearish EMA Stack", value: `EMA20 < EMA50 < SMA200`, detail: "All moving averages aligned bearish." });
    bearish += 2;
  } else {
    findings.push({ type: "neutral", label: "Mixed MAs", value: "Mixed alignment", detail: "Moving averages not clearly aligned." });
  }

  // Price vs MAs
  const price = quote.price;
  if (price > ema20) {
    findings.push({ type: "supporting", label: "Above EMA20", value: `$${price.toFixed(2)} > $${ema20.toFixed(2)}`, detail: "Price above short-term moving average." });
    bullish += 0.5;
  } else {
    findings.push({ type: "contradicting", label: "Below EMA20", value: `$${price.toFixed(2)} < $${ema20.toFixed(2)}`, detail: "Price below short-term moving average." });
    bearish += 0.5;
  }

  // Price vs 200 SMA
  if (price > sma200) {
    findings.push({ type: "supporting", label: "Above 200 SMA", value: `$${price.toFixed(2)} > $${sma200.toFixed(2)}`, detail: "Price above long-term trend line — bullish." });
    bullish += 1;
  } else {
    findings.push({ type: "contradicting", label: "Below 200 SMA", value: `$${price.toFixed(2)} < $${sma200.toFixed(2)}`, detail: "Price below long-term trend line — bearish." });
    bearish += 1;
  }

  // Higher highs / higher lows
  const recent = candles.slice(-20);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);
  const higherHighs = highs[highs.length - 1] > highs[0];
  const higherLows = lows[lows.length - 1] > lows[0];

  if (higherHighs && higherLows) {
    findings.push({ type: "supporting", label: "Higher Highs & Lows", value: "Confirmed", detail: "Price structure shows bullish trend." });
    bullish += 1;
  } else if (!higherHighs && !higherLows) {
    findings.push({ type: "contradicting", label: "Lower Highs & Lows", value: "Confirmed", detail: "Price structure shows bearish trend." });
    bearish += 1;
  }

  const netBullBear = bullish - bearish;
  const direction = netBullBear > 1 ? "bullish" as const : netBullBear < -1 ? "bearish" as const : "neutral" as const;

  return {
    section: { title: "Trend Analysis", direction, confidence: Math.min(0.8, 0.3 + Math.abs(netBullBear) * 0.1), findings, metrics },
    bullish,
    bearish,
  };
}

// ── Momentum ──────────────────────────────────────────────

function analyzeMomentum(candles: Candle[], quote: StockQuote) {
  const findings: Finding[] = [];
  const metrics: Record<string, number | string> = {};
  let bullish = 0;
  let bearish = 0;

  if (candles.length < 20) {
    return {
      section: { title: "Momentum", direction: "neutral" as const, confidence: 0.2, findings: [{ type: "neutral" as const, label: "Insufficient data", value: `${candles.length} candles`, detail: "" }], metrics },
      bullish: 0, bearish: 0,
    };
  }

  const closes = candles.map((c) => c.close);

  // Rate of change
  const roc5 = computeROC(closes, 5);
  const roc10 = computeROC(closes, 10);
  const roc20 = computeROC(closes, 20);
  metrics.roc5 = roc5;
  metrics.roc10 = roc10;
  metrics.roc20 = roc20;

  if (roc5 > 0.03) {
    findings.push({ type: "supporting", label: "Strong 5D Momentum", value: `+${(roc5 * 100).toFixed(1)}%`, detail: "Strong positive momentum over 5 days." });
    bullish += 1;
  } else if (roc5 < -0.03) {
    findings.push({ type: "contradicting", label: "Weak 5D Momentum", value: `${(roc5 * 100).toFixed(1)}%`, detail: "Strong negative momentum over 5 days." });
    bearish += 1;
  }

  if (roc20 > 0.05) {
    findings.push({ type: "supporting", label: "Strong 20D Momentum", value: `+${(roc20 * 100).toFixed(1)}%`, detail: "Solid trend over 20 days." });
    bullish += 0.5;
  } else if (roc20 < -0.05) {
    findings.push({ type: "contradicting", label: "Weak 20D Momentum", value: `${(roc20 * 100).toFixed(1)}%`, detail: "Declining trend over 20 days." });
    bearish += 0.5;
  }

  const netBullBear = bullish - bearish;
  const direction = netBullBear > 0.5 ? "bullish" as const : netBullBear < -0.5 ? "bearish" as const : "neutral" as const;

  return {
    section: { title: "Momentum", direction, confidence: Math.min(0.7, 0.3 + Math.abs(netBullBear) * 0.2), findings, metrics },
    bullish,
    bearish,
  };
}

// ── Volatility ────────────────────────────────────────────

function analyzeVolatility(candles: Candle[], quote: StockQuote) {
  const findings: Finding[] = [];
  const metrics: Record<string, number | string> = {};
  const risks: RiskItem[] = [];

  if (candles.length < 20) {
    return {
      section: { title: "Volatility & Risk", direction: "neutral" as const, confidence: 0.2, findings: [], metrics },
      bullish: 0, bearish: 0,
      risks,
    };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  // ATR
  const atr14 = computeATR(highs, lows, closes, 14);
  const atrPercent = quote.price > 0 ? (atr14 / quote.price) * 100 : 0;
  metrics.atr14 = atr14;
  metrics.atrPercent = atrPercent;

  if (atrPercent > 3) {
    findings.push({ type: "neutral", label: "High Volatility", value: `${atrPercent.toFixed(1)}% ATR`, detail: "Stock showing elevated volatility — wider stops needed." });
    risks.push({ severity: "high", label: "High volatility", description: `ATR at ${atrPercent.toFixed(1)}% of price indicates elevated risk.` });
  } else if (atrPercent < 1) {
    findings.push({ type: "neutral", label: "Low Volatility", value: `${atrPercent.toFixed(1)}% ATR`, detail: "Stock showing low volatility — potential for breakout." });
  } else {
    findings.push({ type: "neutral", label: "Normal Volatility", value: `${atrPercent.toFixed(1)}% ATR`, detail: "Volatility within normal range." });
  }

  // Historical volatility (20-day)
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const recentReturns = returns.slice(-20);
  const hv20 = stddev(recentReturns) * Math.sqrt(252) * 100;
  metrics.hv20 = hv20;

  // Max drawdown in the period
  let peak = -Infinity;
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (peak - c) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  metrics.maxDrawdown = maxDd * 100;

  if (maxDd > 0.15) {
    risks.push({ severity: "high", label: "Significant drawdown", description: `Max drawdown of ${(maxDd * 100).toFixed(1)}% in analyzed period.` });
  }

  return {
    section: { title: "Volatility & Risk", direction: "neutral" as const, confidence: 0.6, findings, metrics },
    bullish: 0,
    bearish: 0,
    risks,
  };
}

// ── Volume Analysis ───────────────────────────────────────

function analyzeVolume(candles: Candle[], quote: StockQuote) {
  const findings: Finding[] = [];
  const metrics: Record<string, number | string> = {};
  let bullish = 0;
  let bearish = 0;

  if (candles.length < 20) {
    return {
      section: { title: "Volume Analysis", direction: "neutral" as const, confidence: 0.2, findings: [], metrics },
      bullish: 0, bearish: 0,
    };
  }

  const volumes = candles.map((c) => c.volume);
  const closes = candles.map((c) => c.close);
  const avgVol20 = mean(volumes.slice(-20));
  const recentVol = volumes[volumes.length - 1];
  const volumeRatio = avgVol20 > 0 ? recentVol / avgVol20 : 1;
  metrics.avgVolume20 = avgVol20;
  metrics.recentVolume = recentVol;
  metrics.volumeRatio = volumeRatio;

  if (volumeRatio > 2) {
    findings.push({ type: "supporting", label: "Volume Surge", value: `${volumeRatio.toFixed(1)}x average`, detail: "Unusually high volume — move is significant." });
    bullish += 0.8;
  } else if (volumeRatio < 0.5) {
    findings.push({ type: "neutral", label: "Low Volume", value: `${volumeRatio.toFixed(1)}x average`, detail: "Low volume — move may not be sustainable." });
  }

  // OBV trend
  const obv = computeOBV(closes, volumes);
  const obvSma = computeEMA(obv, 20);
  if (obv[obv.length - 1] > obvSma[obvSma.length - 1]) {
    findings.push({ type: "supporting", label: "OBV Rising", value: "Above average", detail: "On-Balance Volume trending up — accumulation." });
    bullish += 0.5;
  } else {
    findings.push({ type: "contradicting", label: "OBV Falling", value: "Below average", detail: "On-Balance Volume trending down — distribution." });
    bearish += 0.5;
  }

  const netBullBear = bullish - bearish;
  const direction = netBullBear > 0.3 ? "bullish" as const : netBullBear < -0.3 ? "bearish" as const : "neutral" as const;

  return {
    section: { title: "Volume Analysis", direction, confidence: Math.min(0.7, 0.3 + Math.abs(netBullBear) * 0.2), findings, metrics },
    bullish,
    bearish,
  };
}

// ── Support/Resistance ────────────────────────────────────

function analyzeSupportResistance(candles: Candle[], quote: StockQuote) {
  const findings: Finding[] = [];
  const metrics: Record<string, number | string> = {};

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const price = quote.price;

  // Simple pivot-based S/R
  const pivot = (highs[highs.length - 1] + lows[lows.length - 1] + closes[closes.length - 1]) / 3;
  const s1 = 2 * pivot - highs[highs.length - 1];
  const r1 = 2 * pivot - lows[lows.length - 1];
  const s2 = pivot - (highs[highs.length - 1] - lows[lows.length - 1]);
  const r2 = pivot + (highs[highs.length - 1] - lows[lows.length - 1]);

  metrics.pivot = pivot;
  metrics.s1 = s1;
  metrics.r1 = r1;

  // Find swing highs and lows for better S/R
  const supportLevels = findSwingLows(lows, 5).sort((a, b) => Math.abs(a - price) - Math.abs(b - price));
  const resistanceLevels = findSwingHighs(highs, 5).sort((a, b) => Math.abs(a - price) - Math.abs(b - price));

  const nearestSupport = (supportLevels.find((s) => s < price) as number | undefined) ?? s1;
  const nearestResistance = (resistanceLevels.find((r) => r > price) as number | undefined) ?? r1;

  findings.push({
    type: "neutral" as const,
    label: "Key Levels",
    value: `S: $${nearestSupport.toFixed(2)} | R: $${nearestResistance.toFixed(2)}`,
    detail: `Nearest support at $${nearestSupport.toFixed(2)}, nearest resistance at $${nearestResistance.toFixed(2)}.`,
  });

  return {
    section: { title: "Support & Resistance", direction: "neutral" as const, confidence: 0.5, findings, metrics },
    supportLevels: [s1, s2, ...supportLevels.slice(0, 3)],
    resistanceLevels: [r1, r2, ...resistanceLevels.slice(0, 3)],
  };
}

// ── Fundamentals ──────────────────────────────────────────

function analyzeFundamentals(fundamentals: FundamentalData, quote: StockQuote) {
  const findings: Finding[] = [];
  const metrics: Record<string, number | string> = {};
  let bullish = 0;
  let bearish = 0;

  // P/E Ratio
  if (fundamentals.trailingPE !== null) {
    metrics.peRatio = fundamentals.trailingPE;
    if (fundamentals.trailingPE < 15) {
      findings.push({ type: "supporting", label: "Low P/E", value: fundamentals.trailingPE.toFixed(1), detail: "P/E ratio below 15 — potentially undervalued." });
      bullish += 1;
    } else if (fundamentals.trailingPE > 30) {
      findings.push({ type: "contradicting", label: "High P/E", value: fundamentals.trailingPE.toFixed(1), detail: "P/E ratio above 30 — potentially overvalued." });
      bearish += 1;
    } else {
      findings.push({ type: "neutral", label: "Fair P/E", value: fundamentals.trailingPE.toFixed(1), detail: "P/E ratio in moderate range." });
    }
  }

  // Beta
  if (fundamentals.beta !== null) {
    metrics.beta = fundamentals.beta;
    if (fundamentals.beta > 1.2) {
      findings.push({ type: "neutral", label: "Above-Average Volatility", value: `Beta ${fundamentals.beta.toFixed(2)}`, detail: "Stock is more volatile than the market." });
    }
  }

  // Market Cap
  metrics.marketCap = fundamentals.marketCap;
  if (fundamentals.marketCap > 200e9) {
    findings.push({ type: "supporting", label: "Large Cap", value: formatMarketCap(fundamentals.marketCap), detail: "Mega-cap stock — generally lower risk." });
    bullish += 0.3;
  } else if (fundamentals.marketCap < 10e9) {
    findings.push({ type: "neutral", label: "Small/Mid Cap", value: formatMarketCap(fundamentals.marketCap), detail: "Smaller company — higher risk/reward." });
  }

  const netBullBear = bullish - bearish;
  const direction = netBullBear > 0.5 ? "bullish" as const : netBullBear < -0.5 ? "bearish" as const : "neutral" as const;

  return {
    section: { title: "Fundamentals", direction, confidence: Math.min(0.6, 0.3 + Math.abs(netBullBear) * 0.15), findings, metrics },
    bullish,
    bearish,
  };
}

// ── Valuation ─────────────────────────────────────────────

function analyzeValuation(quote: StockQuote, fundamentals: FundamentalData | null) {
  const findings: Finding[] = [];
  const metrics: Record<string, number | string> = {};
  let bullish = 0;
  let bearish = 0;

  // 52-week range position
  if (quote.week52High > 0 && quote.week52Low > 0) {
    const range52 = quote.week52High - quote.week52Low;
    const position52 = range52 > 0 ? (quote.price - quote.week52Low) / range52 : 0.5;
    metrics.week52Position = position52 * 100;

    if (position52 > 0.9) {
      findings.push({ type: "contradicting", label: "Near 52-Week High", value: `${(position52 * 100).toFixed(0)}%`, detail: "Trading near 52-week high — limited upside room." });
      bearish += 0.5;
    } else if (position52 < 0.2) {
      findings.push({ type: "supporting", label: "Near 52-Week Low", value: `${(position52 * 100).toFixed(0)}%`, detail: "Trading near 52-week low — potential value or further downside." });
      bullish += 0.5;
    }
  }

  // Price vs previous close
  const gapFromPrevClose = quote.previousClose > 0 ? (quote.price - quote.previousClose) / quote.previousClose : 0;
  metrics.gapFromPrevClose = gapFromPrevClose * 100;

  const netBullBear = bullish - bearish;
  const direction = netBullBear > 0.3 ? "bullish" as const : netBullBear < -0.3 ? "bearish" as const : "neutral" as const;

  return {
    section: { title: "Valuation & Range", direction, confidence: 0.4, findings, metrics },
    bullish,
    bearish,
  };
}

// ── Key Levels Computation ────────────────────────────────

function computeKeyLevels(
  candles: Candle[],
  quote: StockQuote,
  supportLevels: number[],
  resistanceLevels: number[],
): KeyLevels {
  const price = quote.price;
  const atr = candles.length >= 14
    ? computeATR(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), 14)
    : price * 0.02;

  return {
    support: supportLevels.filter((s) => s < price).slice(0, 3),
    resistance: resistanceLevels.filter((r) => r > price).slice(0, 3),
    stopLoss: price - atr * 2,
    takeProfit: price + atr * 4,
    pivot: (candles[candles.length - 1]?.high + candles[candles.length - 1]?.low + price) / 3,
  };
}

// ── Summary Generator ─────────────────────────────────────

function generateSummary(
  quote: StockQuote,
  direction: AnalysisDirection,
  confidence: number,
  sections: AnalysisSection[],
  risks: RiskItem[],
): string {
  const parts: string[] = [];

  parts.push(`${quote.name} (${quote.symbol}) is currently trading at $${quote.price.toFixed(2)}`);

  if (quote.changePercent !== 0) {
    parts[parts.length - 1] += ` (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%)`;
  }
  parts[parts.length - 1] += ".";

  const bullishSections = sections.filter((s) => s.direction === "bullish").length;
  const bearishSections = sections.filter((s) => s.direction === "bearish").length;

  if (direction === "bullish") {
    parts.push(`The overall analysis is BULLISH with ${(confidence * 100).toFixed(0)}% confidence.`);
    parts.push(`${bullishSections} analysis sections support the bullish view, while ${bearishSections} indicate caution.`);
  } else if (direction === "bearish") {
    parts.push(`The overall analysis is BEARISH with ${(confidence * 100).toFixed(0)}% confidence.`);
    parts.push(`${bearishSections} analysis sections indicate bearish pressure, while ${bullishSections} suggest potential upside.`);
  } else {
    parts.push(`The overall analysis is NEUTRAL with ${(confidence * 100).toFixed(0)}% confidence.`);
    parts.push("Signals are mixed — no clear directional edge.");
  }

  if (risks.length > 0) {
    parts.push(`${risks.length} risk factor(s) identified.`);
  }

  return parts.join(" ");
}

// ── Indicator Helpers ─────────────────────────────────────

function computeRSI(closes: number[], period: number): number {
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

function computeEMA(data: number[], period: number): number[] {
  if (data.length < period) return data.slice();
  const k = 2 / (period + 1);
  const ema: number[] = [data.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < data.length; i++) {
    ema.push(data[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

function computeSMA(data: number[], period: number): number {
  if (data.length < period) return data.length > 0 ? data.reduce((a, b) => a + b, 0) / data.length : 0;
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function computeMACD(closes: number[]) {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const minLen = Math.min(ema12.length, ema26.length);
  const macdLine = ema12.slice(-minLen).map((v, i) => v - ema26[i]);
  const signal = computeEMA(macdLine, 9);
  const mLen = Math.min(macdLine.length, signal.length);
  return {
    macd: macdLine[macdLine.length - 1] ?? 0,
    signal: signal[signal.length - 1] ?? 0,
    histogram: (macdLine[macdLine.length - 1] ?? 0) - (signal[signal.length - 1] ?? 0),
  };
}

function computeBollingerBands(closes: number[], period: number) {
  if (closes.length < period) return { upper: 0, lower: 0, middle: 0 };
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, x) => s + (x - sma) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return { upper: sma + 2 * std, lower: sma - 2 * std, middle: sma };
}

function computeATR(highs: number[], lows: number[], closes: number[], period: number): number {
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

function computeROC(closes: number[], period: number): number {
  if (closes.length <= period) return 0;
  return (closes[closes.length - 1] - closes[closes.length - 1 - period]) / closes[closes.length - 1 - period];
}

function computeOBV(closes: number[], volumes: number[]): number[] {
  const obv: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[obv.length - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) obv.push(obv[obv.length - 1] - volumes[i]);
    else obv.push(obv[obv.length - 1]);
  }
  return obv;
}

function findSwingLows(lows: number[], lookback: number): number[] {
  const swings: number[] = [];
  for (let i = lookback; i < lows.length - lookback; i++) {
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (lows[i] > lows[i - j] || lows[i] > lows[i + j]) { isLow = false; break; }
    }
    if (isLow) swings.push(lows[i]);
  }
  return [...new Set(swings)];
}

function findSwingHighs(highs: number[], lookback: number): number[] {
  const swings: number[] = [];
  for (let i = lookback; i < highs.length - lookback; i++) {
    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (highs[i] < highs[i - j] || highs[i] < highs[i + j]) { isHigh = false; break; }
    }
    if (isHigh) swings.push(highs[i]);
  }
  return [...new Set(swings)];
}

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
  return `$${cap.toFixed(0)}`;
}
