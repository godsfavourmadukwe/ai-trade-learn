// ============================================================
// TRADSLY Pair Analysis Engine
//
// Deterministic quantitative analysis for ANY registered pair.
// Uses REAL market data (historical OHLCV, live price, volume,
// order-book top). No mock values. No leakage: every feature is
// computed only from candles up to (and including) the current
// forming candle — nothing from the future.
// ============================================================

export type PairRegime =
  | "strong_uptrend" | "uptrend" | "ranging"
  | "downtrend" | "strong_downtrend"
  | "high_volatility" | "low_volatility" | "unknown";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

export interface PairFeatures {
  price: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
  atrPercent: number | null;
  trendSlopePct: number | null;
  volumeZ: number | null;
  volumeVsMa20: number | null;
  spreadPct: number | null;
  bookImbalance: number | null;
  change24hPercent: number | null;
  high24h: number | null;
  low24h: number | null;
  quoteVolume24h: number | null;
  distanceToHigh24hPct: number | null;
  distanceToLow24hPct: number | null;
  samples: number;
}

export interface ThesisEvaluation {
  verdict: "supports" | "mixed" | "contradicts";
  agreementScore: number; // 0..100 — how much the data supports the thesis
  supporting: string[];
  contradicting: string[];
  risks: string[];
  invalidation: string[];
  conclusion: string;
}

export interface PairAnalysis {
  symbol: string; // display symbol, e.g. "ETH/USDT"
  exchangeSymbol: string;
  exchange: string;
  regime: PairRegime;
  features: PairFeatures;
  indicators: {
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    rsi14: number | null;
    atr14: number | null;
    atrPercent: number | null;
    volumeVsMa20: number | null;
  };
  confidence: number; // 0..100 — data-sufficiency based
  dataHealth: {
    ok: boolean;
    samples: number;
    stale: boolean;
    message: string;
  };
  summary: string;
  reasons: string[];
  thesis: ThesisEvaluation | null;
  generatedAt: number;
  modelVersion: string;
}

// ------------------------------------------------------------
// Indicators (computed from candles[0..n] only — no future data)
// ------------------------------------------------------------

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    sum += tr;
  }
  return sum / period;
}

export function linearSlopePctPerBar(values: number[]): number | null {
  const n = values.length;
  if (n < 10) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  if (den === 0 || meanY === 0) return null;
  return ((num / den) / meanY) * 100;
}

// ------------------------------------------------------------
// Regime detection
// ------------------------------------------------------------

export function detectRegime(f: PairFeatures): PairRegime {
  const { ema50, ema200, rsi14, atrPercent, price } = f;
  if (ema50 == null || ema200 == null || price == null || price <= 0) return "unknown";

  // Volatility extremes override trend labels only when truly extreme.
  // (On 1m candles ATR% is naturally small — don't let it mask real trends.)
  if (atrPercent != null && atrPercent > 5) return "high_volatility";
  if (atrPercent != null && atrPercent < 0.03 && Math.abs(f.trendSlopePct ?? 0) < 0.02) {
    return "low_volatility";
  }

  const bullStack = ema50 > ema200;
  const above200 = price > ema200;
  const slope = f.trendSlopePct ?? 0;
  if (bullStack && above200 && slope > 0.05) return "strong_uptrend";
  if (bullStack && above200) return "uptrend";
  if (!bullStack && !above200 && slope < -0.05) return "strong_downtrend";
  if (!bullStack && !above200) return "downtrend";
  return "ranging";
}

// ------------------------------------------------------------
// Feature extraction
// ------------------------------------------------------------

export function extractFeatures(input: {
  candles: Candle[];
  livePrice: number | null;
  spreadPct: number | null;
  bookImbalance: number | null;
  ticker: { change24hPercent: number; high24h: number; low24h: number; quoteVolume24h: number } | null;
}): PairFeatures {
  const { candles, livePrice, spreadPct, bookImbalance, ticker } = input;
  const valid = candles.filter(
    (c) =>
      Number.isFinite(c.time) && c.time > 0 &&
      Number.isFinite(c.open) && c.open > 0 &&
      Number.isFinite(c.high) && c.high > 0 &&
      Number.isFinite(c.low) && c.low > 0 &&
      Number.isFinite(c.close) && c.close > 0 &&
      Number.isFinite(c.volume) && c.volume >= 0 &&
      c.high >= c.low &&
      c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close),
  );
  const closes = valid.map((c) => c.close);
  const price = livePrice && livePrice > 0 ? livePrice : (closes[closes.length - 1] ?? null);

  const ema20 = ema(closes, 20);
  const ema50v = ema(closes, 50);
  const ema200v = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(valid, 14);
  const atrPercent = atr14 != null && price ? (atr14 / price) * 100 : null;

  const slopeWindow = closes.slice(-60);
  const trendSlopePct = linearSlopePctPerBar(slopeWindow);

  const vols = valid.slice(-60).map((c) => c.volume);
  const volMa20 = vols.length >= 20 ? vols.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const lastVol = vols[vols.length - 1] ?? null;
  const volumeVsMa20 = volMa20 && lastVol != null && volMa20 > 0 ? lastVol / volMa20 : null;
  const volMean = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  const volStd = vols.length > 1
    ? Math.sqrt(vols.reduce((a, b) => a + (b - (volMean ?? 0)) ** 2, 0) / vols.length)
    : null;
  const volumeZ = volMean != null && volStd && volStd > 0 && lastVol != null
    ? (lastVol - volMean) / volStd
    : null;

  const high24h = ticker?.high24h ?? null;
  const low24h = ticker?.low24h ?? null;
  const distanceToHigh24hPct = high24h && price ? ((high24h - price) / price) * 100 : null;
  const distanceToLow24hPct = low24h && price ? ((price - low24h) / price) * 100 : null;

  return {
    price,
    ema20,
    ema50: ema50v,
    ema200: ema200v,
    rsi14,
    atr14,
    atrPercent,
    trendSlopePct,
    volumeZ,
    volumeVsMa20,
    spreadPct,
    bookImbalance,
    change24hPercent: ticker?.change24hPercent ?? null,
    high24h,
    low24h,
    quoteVolume24h: ticker?.quoteVolume24h ?? null,
    distanceToHigh24hPct,
    distanceToLow24hPct,
    samples: valid.length,
  };
}

// ------------------------------------------------------------
// Analysis + thesis evaluation
// ------------------------------------------------------------

function pct(v: number | null | undefined, digits = 2): string {
  return v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function analyzePair(input: {
  symbol: string;
  exchangeSymbol: string;
  exchange: string;
  candles: Candle[];
  livePrice: number | null;
  ticker: { change24hPercent: number; high24h: number; low24h: number; quoteVolume24h: number } | null;
  orderBook: { bid: number; ask: number; bidQty: number; askQty: number } | null;
  now: number;
}): PairAnalysis {
  const { symbol, exchangeSymbol, exchange, candles, livePrice, ticker, orderBook, now } = input;

  let spreadPct: number | null = null;
  let bookImbalance: number | null = null;
  if (orderBook && orderBook.bid > 0 && orderBook.ask > orderBook.bid) {
    const mid = (orderBook.bid + orderBook.ask) / 2;
    spreadPct = ((orderBook.ask - orderBook.bid) / mid) * 100;
    const total = orderBook.bidQty + orderBook.askQty;
    bookImbalance = total > 0 ? (orderBook.bidQty - orderBook.askQty) / total : null;
  }

  const features = extractFeatures({ candles, livePrice, spreadPct, bookImbalance, ticker });
  const regime = detectRegime(features);

  // Data sufficiency: 50+ candles = decent, 200+ = full EMA200 context
  const freshnessMs = 10 * 60 * 1000; // 1m candles; allow 10 min staleness
  const lastCandle = candles[candles.length - 1];
  const stale = !lastCandle || now - lastCandle.time > freshnessMs + 60_000;
  const ok = features.samples >= 30 && features.price != null && features.price > 0 && !stale;
  const confidence = Math.min(
    95,
    Math.round(
      (features.samples >= 200 ? 90 : features.samples >= 100 ? 75 : features.samples >= 50 ? 60 : 40) +
      (stale ? -20 : 0) +
      (spreadPct != null ? 5 : 0),
    ),
  );

  const reasons: string[] = [];
  if (features.ema50 != null && features.ema200 != null) {
    reasons.push(
      features.ema50 > features.ema200
        ? `EMA50 (${features.ema50.toPrecision(6)}) above EMA200 (${features.ema200.toPrecision(6)}) — bullish medium-term structure`
        : `EMA50 (${features.ema50.toPrecision(6)}) below EMA200 (${features.ema200.toPrecision(6)}) — bearish medium-term structure`,
    );
  }
  if (features.rsi14 != null) {
    const r = features.rsi14;
    reasons.push(
      r >= 70 ? `RSI(14) ${r.toFixed(1)} — overbought zone`
      : r <= 30 ? `RSI(14) ${r.toFixed(1)} — oversold zone`
      : `RSI(14) ${r.toFixed(1)} — neutral momentum`,
    );
  }
  if (features.atrPercent != null) {
    reasons.push(`ATR(14) ${features.atrPercent.toFixed(2)}% of price — ${features.atrPercent > 3 ? "elevated" : features.atrPercent < 0.5 ? "compressed" : "normal"} volatility`);
  }
  if (features.volumeVsMa20 != null) {
    reasons.push(`Volume ${features.volumeVsMa20.toFixed(2)}× its 20-bar average`);
  }
  if (spreadPct != null) reasons.push(`Book spread ${spreadPct.toFixed(3)}%${bookImbalance != null ? `, bid/ask imbalance ${(bookImbalance * 100).toFixed(0)}%` : ""}`);
  if (features.change24hPercent != null) reasons.push(`24h change ${pct(features.change24hPercent)}`);

  const summary = ok
    ? `${symbol} is in a ${regime.replace("_", " ")} regime. Price ${features.price?.toPrecision(6)}, ${pct(features.change24hPercent)} over 24h.`
    : `Insufficient or stale market data for ${symbol} — analysis withheld (${features.samples} valid candles).`;

  return {
    symbol,
    exchangeSymbol,
    exchange,
    regime,
    features,
    indicators: {
      ema20: features.ema20,
      ema50: features.ema50,
      ema200: features.ema200,
      rsi14: features.rsi14,
      atr14: features.atr14,
      atrPercent: features.atrPercent,
      volumeVsMa20: features.volumeVsMa20,
    },
    confidence,
    dataHealth: {
      ok,
      samples: features.samples,
      stale,
      message: ok
        ? `${features.samples} candles, live`
        : stale
          ? "Candle data is stale — refusing to analyze"
          : `Only ${features.samples} valid candles — refusing to analyze`,
    },
    summary,
    reasons,
    thesis: null,
    generatedAt: now,
    modelVersion: "pair-analysis-v1",
  };
}

/**
 * Evaluate a user's thesis against the extracted features.
 * Deliberately evidence-based: it does NOT blindly agree. Each thesis
 * keyword/intent is checked against computed indicators, and the verdict
 * (supports / mixed / contradicts) follows the evidence.
 */
export function evaluateThesis(
  thesis: string,
  analysis: PairAnalysis,
): ThesisEvaluation {
  const f = analysis.features;
  const t = thesis.toLowerCase();
  const bullishThesis = /\b(bull|bullish|long|pump|breakout|break\s*up|continuation|uptrend|higher|rally|moonic|buy|accumulate|support\s*hold|resistance\s*break)\b/.test(t);
  const bearishThesis = /\b(bear|bearish|short|dump|break\s*down|breakdown|downtrend|lower|crash|sell|rejection|resistance\s*hold|support\s*break)\b/.test(t);

  const supporting: string[] = [];
  const contradicting: string[] = [];
  const risks: string[] = [];
  const invalidation: string[] = [];

  const bullEvidence: string[] = [];
  const bearEvidence: string[] = [];

  if (f.ema50 != null && f.ema200 != null) {
    (f.ema50 > f.ema200 ? bullEvidence : bearEvidence).push(
      `EMA50 is ${f.ema50 > f.ema200 ? "above" : "below"} EMA200 (trend structure ${f.ema50 > f.ema200 ? "bullish" : "bearish"})`,
    );
  }
  if (f.trendSlopePct != null) {
    (f.trendSlopePct > 0 ? bullEvidence : bearEvidence).push(
      `60-bar price slope is ${pct(f.trendSlopePct)} per bar (${f.trendSlopePct > 0 ? "rising" : "falling"})`,
    );
  }
  if (f.rsi14 != null) {
    if (f.rsi14 >= 70) bearEvidence.push(`RSI(14) at ${f.rsi14.toFixed(1)} — overbought, momentum may exhaust`);
    else if (f.rsi14 <= 30) bullEvidence.push(`RSI(14) at ${f.rsi14.toFixed(1)} — oversold, mean-reversion bounce plausible`);
    else (f.rsi14 > 50 ? bullEvidence : bearEvidence).push(`RSI(14) at ${f.rsi14.toFixed(1)} — momentum ${f.rsi14 > 50 ? "leaning up" : "leaning down"}`);
  }
  if (f.change24hPercent != null) {
    (f.change24hPercent >= 0 ? bullEvidence : bearEvidence).push(
      `24h change ${pct(f.change24hPercent)}`,
    );
  }
  if (f.volumeVsMa20 != null) {
    if (f.volumeVsMa20 > 1.2) bullEvidence.push(`Volume ${f.volumeVsMa20.toFixed(2)}× its 20-bar average — participation expanding`);
    else if (f.volumeVsMa20 < 0.8) bearEvidence.push(`Volume ${f.volumeVsMa20.toFixed(2)}× its 20-bar average — participation fading`);
  }
  if (f.distanceToHigh24hPct != null && f.distanceToHigh24hPct < 1) {
    bullEvidence.push(`Price is within ${f.distanceToHigh24hPct.toFixed(2)}% of the 24h high — near-term strength`);
  }
  if (f.distanceToLow24hPct != null && f.distanceToLow24hPct < 1) {
    bearEvidence.push(`Price is within ${f.distanceToLow24hPct.toFixed(2)}% of the 24h low — near-term weakness`);
  }
  if (analysis.regime === "high_volatility") risks.push("ATR shows elevated volatility — wider stops required, stop-hunts likelier");
  if (analysis.regime === "low_volatility") risks.push("Volatility compressed — breakouts may be false or slow");
  if (analysis.regime === "ranging") risks.push("Market is ranging — directional theses need a confirmed break of range");
  if (f.spreadPct != null && f.spreadPct > 0.1) risks.push(`Spread ${f.spreadPct.toFixed(3)}% is wide — execution cost will eat thin edges`);
  if (f.bookImbalance != null && Math.abs(f.bookImbalance) > 0.4) {
    (f.bookImbalance > 0 ? bullEvidence : bearEvidence).push(
      `Order book leans ${f.bookImbalance > 0 ? "bid" : "ask"} (${(f.bookImbalance * 100).toFixed(0)}% imbalance)`,
    );
  }

  if (bullishThesis && !bearishThesis) {
    supporting.push(...bullEvidence);
    contradicting.push(...bearEvidence);
  } else if (bearishThesis && !bullishThesis) {
    supporting.push(...bearEvidence);
    contradicting.push(...bullEvidence);
  } else {
    // Ambiguous thesis — present both sides
    supporting.push(...bullEvidence.slice(0, 3));
    contradicting.push(...bearEvidence.slice(0, 3));
    risks.unshift("Thesis direction is ambiguous — both bull and bear evidence listed");
  }

  const pos = supporting.length;
  const neg = contradicting.length;
  const agreementScore = pos + neg === 0 ? 50 : Math.round((pos / (pos + neg)) * 100);
  const verdict: ThesisEvaluation["verdict"] =
    agreementScore >= 65 ? "supports" : agreementScore <= 35 ? "contradicts" : "mixed";

  // Invalidation levels are derived from real structure, not invented
  if (f.ema50 != null) {
    invalidation.push(
      bullishThesis
        ? `Thesis weakens if price closes decisively below EMA50 (${f.ema50.toPrecision(6)})`
        : `Thesis weakens if price reclaims EMA50 (${f.ema50.toPrecision(6)}) and holds`,
    );
  }
  if (f.atr14 != null && f.price) {
    invalidation.push(
      bullishThesis
        ? `A close more than 1.5×ATR (${(1.5 * f.atr14).toFixed(f.price < 1 ? 6 : 2)}) below current price invalidates the continuation idea`
        : `A close more than 1.5×ATR (${(1.5 * f.atr14).toFixed(f.price < 1 ? 6 : 2)}) above current price invalidates the breakdown idea`,
    );
  }
  if (f.high24h != null && bullishThesis) {
    invalidation.push(`Failure at the 24h high (${f.high24h.toPrecision(6)}) with rising sell volume argues against continuation`);
  }
  if (f.low24h != null && bearishThesis) {
    invalidation.push(`Reclaim of the 24h low (${f.low24h.toPrecision(6)}) argues against the breakdown idea`);
  }
  if (invalidation.length === 0) invalidation.push("No structural invalidation level could be derived from available data");

  const conclusion =
    verdict === "supports"
      ? `The current data is broadly consistent with your thesis for ${analysis.symbol} (${pos} supporting vs ${neg} contradicting evidence items). Key risk: ${risks[0] ?? "execution timing"}.`
      : verdict === "contradicts"
        ? `The current data largely disagrees with your thesis for ${analysis.symbol} (${neg} contradicting vs ${pos} supporting evidence items). The evidence does not support the position right now — do not force the trade.`
        : `Evidence for ${analysis.symbol} is mixed (${pos} supporting vs ${neg} contradicting). Your thesis is neither confirmed nor denied — wait for the invalidation levels to resolve.`;

  return { verdict, agreementScore, supporting, contradicting, risks, invalidation, conclusion };
}
