// ============================================================
// AI TRADE ARENA — Event Collector
//
// Collects and manages market events from available data sources.
// Uses heuristic/NLP-lite classification since we don't have
// direct access to news APIs. Evaluates events based on
// measurable market reactions.
//
// NEVER invents events. If no events are available, returns
// an empty intelligence snapshot with neutral stance.
// ============================================================

import type {
  MarketEvent,
  EventIntelligence,
  EventFactor,
  EventCollectorConfig,
  EventType,
  EventImpact,
  EventConfirmation,
  EventEvidence,
  AffectedAsset,
} from "./types";
import {
  EVENT_IMPACT_WEIGHTS,
  IMPACT_DIRECTION,
  DEFAULT_EVENT_COLLECTOR_CONFIG,
} from "./types";
import type { Candle } from "@/lib/market/types";

// ── Event Store ───────────────────────────────────────────

const eventStore = new Map<string, MarketEvent>();
let config: EventCollectorConfig = { ...DEFAULT_EVENT_COLLECTOR_CONFIG };

// ── Event ID Generation ───────────────────────────────────

let eventCounter = 0;
function generateEventId(): string {
  eventCounter++;
  return `evt_${Date.now()}_${eventCounter}`;
}

// ── Price/Volume Event Detection ──────────────────────────

/**
 * Detects market events by analyzing price and volume behavior.
 * This is the primary event detection mechanism — it uses
 * measurable market data rather than external news feeds.
 *
 * Events detected:
 * - Unusual volume spikes
 * - Sharp price movements (potential news-driven)
 * - Volatility regime changes
 * - Potential support/resistance breaks
 */
export function detectMarketEvents(
  symbol: string,
  candles15m: Candle[],
  candles1h: Candle[],
  livePrice: number,
  ticker: {
    change24hPercent: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    open24h: number;
  } | null,
  now: number,
): MarketEvent[] {
  const events: MarketEvent[] = [];

  if (candles15m.length < 20 || !ticker) return events;

  // ── 1. Unusual Volume Detection ──
  const volumeEvents = detectVolumeAnomalies(symbol, candles15m, ticker, now);
  events.push(...volumeEvents);

  // ── 2. Sharp Price Movement Detection ──
  const priceEvents = detectPriceShocks(symbol, candles15m, livePrice, ticker, now);
  events.push(...priceEvents);

  // ── 3. Volatility Regime Change Detection ──
  const volEvents = detectVolatilityShifts(symbol, candles15m, candles1h, now);
  events.push(...volEvents);

  // ── 4. Key Level Break Detection ──
  const breakoutEvents = detectKeyLevelBreaks(symbol, candles15m, livePrice, now);
  events.push(...breakoutEvents);

  // ── 5. 24h Structure Events ──
  const structureEvents = detect24hStructureEvents(symbol, ticker, livePrice, now);
  events.push(...structureEvents);

  return events;
}

// ── Volume Anomaly Detection ──────────────────────────────

function detectVolumeAnomalies(
  symbol: string,
  candles: Candle[],
  ticker: { volume24h: number; change24hPercent: number },
  now: number,
): MarketEvent[] {
  const events: MarketEvent[] = [];
  if (candles.length < 30) return events;

  // Compute volume statistics
  const recentVolumes = candles.slice(-20).map((c) => c.volume);
  const historicalVolumes = candles.slice(-50, -20).map((c) => c.volume);

  if (historicalVolumes.length < 10) return events;

  const recentAvg = mean(recentVolumes);
  const histAvg = mean(historicalVolumes);
  const histStd = stddev(historicalVolumes);

  if (histAvg <= 0 || histStd <= 0) return events;

  const volumeZScore = (recentAvg - histAvg) / histStd;

  // Unusual volume: z-score > 2
  if (volumeZScore > 2.0) {
    const lastCandle = candles[candles.length - 1];
    const isBullish = lastCandle.close > lastCandle.open;
    const priceChange = (lastCandle.close - lastCandle.open) / lastCandle.open;

    const impact: EventImpact = isBullish
      ? priceChange > 0.02 ? "bullish" : "slightly_bullish"
      : priceChange < -0.02 ? "bearish" : "slightly_bearish";

    const evidence: EventEvidence[] = [
      {
        type: "volume_spike",
        description: `Volume ${volumeZScore.toFixed(1)}σ above average`,
        strength: Math.min(1, volumeZScore / 4),
        dataPoints: { zScore: volumeZScore, recentAvg, histAvg },
      },
    ];

    events.push(createEvent({
      type: "liquidity_change",
      headline: `Unusual ${isBullish ? "buying" : "selling"} volume detected on ${symbol}`,
      summary: `Volume is ${volumeZScore.toFixed(1)} standard deviations above the 20-period average. ${isBullish ? "Bullish" : "Bearish"} price action accompanies the volume spike.`,
      affectedAssets: [{ symbol, directness: "direct", expectedImpact: impact, confidence: Math.min(0.8, 0.4 + volumeZScore * 0.1) }],
      impact,
      confidence: Math.min(0.8, 0.4 + volumeZScore * 0.1),
      evidence,
      tags: ["volume", "anomaly"],
      relevance: Math.min(1, volumeZScore / 3),
    }));
  }

  return events;
}

// ── Price Shock Detection ─────────────────────────────────

function detectPriceShocks(
  symbol: string,
  candles: Candle[],
  livePrice: number,
  ticker: { change24hPercent: number; high24h: number; low24h: number; open24h: number },
  now: number,
): MarketEvent[] {
  const events: MarketEvent[] = [];

  // Check for large single-candle moves
  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) return events;

  const bodyPercent = Math.abs(lastCandle.close - lastCandle.open) / lastCandle.open;
  const wickPercent = (Math.max(lastCandle.high, lastCandle.open, lastCandle.close) -
    Math.min(lastCandle.low, lastCandle.open, lastCandle.close)) / lastCandle.open;

  // Large body candle (>2% on 15m is significant)
  if (bodyPercent > 0.02) {
    const isBullish = lastCandle.close > lastCandle.open;
    const impact: EventImpact = isBullish
      ? bodyPercent > 0.04 ? "highly_bullish" : "bullish"
      : bodyPercent > 0.04 ? "highly_bearish" : "bearish";

    events.push(createEvent({
      type: "technical_alert",
      headline: `Significant ${isBullish ? "bullish" : "bearish"} price movement on ${symbol}`,
      summary: `Price moved ${(bodyPercent * 100).toFixed(1)}% in a single 15m candle. ${isBullish ? "Strong buying pressure" : "Strong selling pressure"} detected.`,
      affectedAssets: [{ symbol, directness: "direct", expectedImpact: impact, confidence: Math.min(0.75, 0.4 + bodyPercent * 5) }],
      impact,
      confidence: Math.min(0.75, 0.4 + bodyPercent * 5),
      evidence: [
        {
          type: "price_reaction",
          description: `Candle body ${(bodyPercent * 100).toFixed(1)}% of price`,
          strength: Math.min(1, bodyPercent * 10),
          dataPoints: { bodyPercent, wickPercent },
        },
      ],
      tags: ["price_shock", "technical"],
      relevance: Math.min(1, bodyPercent * 15),
    }));
  }

  // 24h range proximity — near extremes
  const range = ticker.high24h - ticker.low24h;
  if (range > 0) {
    const positionInRange = (livePrice - ticker.low24h) / range;
    if (positionInRange > 0.95) {
      events.push(createEvent({
        type: "technical_alert",
        headline: `${symbol} at 24h highs`,
        summary: `Price is within 5% of the 24h high (${ticker.high24h.toFixed(2)}). Potential breakout or resistance test.`,
        affectedAssets: [{ symbol, directness: "direct", expectedImpact: "slightly_bullish", confidence: 0.5 }],
        impact: "slightly_bullish",
        confidence: 0.5,
        evidence: [{
          type: "price_reaction",
          description: `At ${((positionInRange) * 100).toFixed(0)}% of 24h range`,
          strength: positionInRange,
          dataPoints: { positionInRange, high24h: ticker.high24h, low24h: ticker.low24h },
        }],
        tags: ["range_extreme", "technical"],
        relevance: 0.5,
      }));
    } else if (positionInRange < 0.05) {
      events.push(createEvent({
        type: "technical_alert",
        headline: `${symbol} at 24h lows`,
        summary: `Price is within 5% of the 24h low (${ticker.low24h.toFixed(2)}). Potential breakdown or support test.`,
        affectedAssets: [{ symbol, directness: "direct", expectedImpact: "slightly_bearish", confidence: 0.5 }],
        impact: "slightly_bearish",
        confidence: 0.5,
        evidence: [{
          type: "price_reaction",
          description: `At ${((1 - positionInRange) * 100).toFixed(0)}% from 24h low`,
          strength: 1 - positionInRange,
          dataPoints: { positionInRange, high24h: ticker.high24h, low24h: ticker.low24h },
        }],
        tags: ["range_extreme", "technical"],
        relevance: 0.5,
      }));
    }
  }

  return events;
}

// ── Volatility Shift Detection ────────────────────────────

function detectVolatilityShifts(
  symbol: string,
  candles15m: Candle[],
  candles1h: Candle[],
  now: number,
): MarketEvent[] {
  const events: MarketEvent[] = [];
  if (candles15m.length < 40) return events;

  // Compute recent vs historical volatility (using ATR-based)
  const recentATR = computeATR(candles15m.slice(-10), 10);
  const histATR = computeATR(candles15m.slice(-40, -10), 10);
  const price = candles15m[candles15m.length - 1]?.close ?? 0;

  if (histATR <= 0 || price <= 0) return events;

  const volRatio = recentATR / histATR;

  if (volRatio > 2.0) {
    events.push(createEvent({
      type: "technical_alert",
      headline: `Volatility expansion on ${symbol}`,
      summary: `Recent volatility is ${volRatio.toFixed(1)}x the recent average. Market may be entering a high-volatility regime.`,
      affectedAssets: [{ symbol, directness: "direct", expectedImpact: "neutral", confidence: 0.6 }],
      impact: "neutral",
      confidence: 0.6,
      evidence: [{
        type: "price_reaction",
        description: `ATR ratio ${volRatio.toFixed(1)}x`,
        strength: Math.min(1, (volRatio - 1) / 2),
        dataPoints: { volRatio, recentATR, histATR },
      }],
      tags: ["volatility", "regime_change"],
      relevance: 0.6,
    }));
  } else if (volRatio < 0.4) {
    events.push(createEvent({
      type: "technical_alert",
      headline: `Volatility compression on ${symbol}`,
      summary: `Recent volatility is ${(volRatio).toFixed(1)}x the recent average. Market may be preparing for a breakout.`,
      affectedAssets: [{ symbol, directness: "direct", expectedImpact: "neutral", confidence: 0.5 }],
      impact: "neutral",
      confidence: 0.5,
      evidence: [{
        type: "price_reaction",
        description: `ATR ratio ${volRatio.toFixed(2)}x (compressed)`,
        strength: Math.min(1, (1 - volRatio)),
        dataPoints: { volRatio, recentATR, histATR },
      }],
      tags: ["volatility", "compression"],
      relevance: 0.5,
    }));
  }

  return events;
}

// ── Key Level Break Detection ─────────────────────────────

function detectKeyLevelBreaks(
  symbol: string,
  candles: Candle[],
  livePrice: number,
  now: number,
): MarketEvent[] {
  const events: MarketEvent[] = [];
  if (candles.length < 25) return events;

  // Donchian channel (20 period)
  const recent = candles.slice(-21);
  const donchianHigh = Math.max(...recent.slice(0, -1).map((c) => c.high));
  const donchianLow = Math.min(...recent.slice(0, -1).map((c) => c.low));

  // Break above 20-period high
  if (livePrice > donchianHigh) {
    events.push(createEvent({
      type: "technical_alert",
      headline: `${symbol} breaking above 20-period high`,
      summary: `Price (${livePrice.toFixed(2)}) has broken above the 20-period Donchian high (${donchianHigh.toFixed(2)}). Potential bullish breakout.`,
      affectedAssets: [{ symbol, directness: "direct", expectedImpact: "bullish", confidence: 0.65 }],
      impact: "bullish",
      confidence: 0.65,
      evidence: [{
        type: "price_reaction",
        description: `Broke above ${donchianHigh.toFixed(2)}`,
        strength: Math.min(1, (livePrice - donchianHigh) / donchianHigh * 50),
        dataPoints: { breakLevel: donchianHigh, currentPrice: livePrice },
      }],
      tags: ["breakout", "technical"],
      relevance: 0.7,
    }));
  }

  // Break below 20-period low
  if (livePrice < donchianLow) {
    events.push(createEvent({
      type: "technical_alert",
      headline: `${symbol} breaking below 20-period low`,
      summary: `Price (${livePrice.toFixed(2)}) has broken below the 20-period Donchian low (${donchianLow.toFixed(2)}). Potential bearish breakdown.`,
      affectedAssets: [{ symbol, directness: "direct", expectedImpact: "bearish", confidence: 0.65 }],
      impact: "bearish",
      confidence: 0.65,
      evidence: [{
        type: "price_reaction",
        description: `Broke below ${donchianLow.toFixed(2)}`,
        strength: Math.min(1, (donchianLow - livePrice) / donchianLow * 50),
        dataPoints: { breakLevel: donchianLow, currentPrice: livePrice },
      }],
      tags: ["breakdown", "technical"],
      relevance: 0.7,
    }));
  }

  return events;
}

// ── 24h Structure Events ──────────────────────────────────

function detect24hStructureEvents(
  symbol: string,
  ticker: { change24hPercent: number; high24h: number; low24h: number; volume24h: number; open24h: number },
  livePrice: number,
  now: number,
): MarketEvent[] {
  const events: MarketEvent[] = [];

  // Large 24h move (>5%)
  if (Math.abs(ticker.change24hPercent) > 5) {
    const impact: EventImpact = ticker.change24hPercent > 0
      ? ticker.change24hPercent > 10 ? "highly_bullish" : "bullish"
      : ticker.change24hPercent < -10 ? "highly_bearish" : "bearish";

    events.push(createEvent({
      type: "market_commentary",
      headline: `${symbol} moved ${ticker.change24hPercent.toFixed(1)}% in 24h`,
      summary: `Significant 24h price movement of ${ticker.change24hPercent.toFixed(1)}%. Range: ${ticker.low24h.toFixed(2)} - ${ticker.high24h.toFixed(2)}.`,
      affectedAssets: [{ symbol, directness: "direct", expectedImpact: impact, confidence: 0.7 }],
      impact,
      confidence: 0.7,
      evidence: [{
        type: "price_reaction",
        description: `24h change: ${ticker.change24hPercent.toFixed(1)}%`,
        strength: Math.min(1, Math.abs(ticker.change24hPercent) / 15),
        dataPoints: { change24h: ticker.change24hPercent, high24h: ticker.high24h, low24h: ticker.low24h },
      }],
      tags: ["price_move", "24h"],
      relevance: Math.min(1, Math.abs(ticker.change24hPercent) / 10),
    }));
  }

  return events;
}



// ── Event Aggregation ─────────────────────────────────────

/**
 * Aggregate multiple events into a single intelligence snapshot
 * for a given symbol and trade side.
 */
export function aggregateEvents(
  symbol: string,
  events: MarketEvent[],
  side: "long" | "short",
  now: number,
): EventIntelligence {
  // Filter to relevant, non-expired events
  const active = events.filter(
    (e) => e.expiresAt > now && e.confidence >= config.minConfidence,
  );

  if (active.length === 0) {
    return {
      symbol,
      activeEvents: [],
      directionalBias: 0,
      confidence: 0,
      uncertainty: 0.5,
      factors: [],
      veto: false,
      vetoReason: null,
      generatedAt: now,
      eventCount: 0,
      confirmedCount: 0,
      unconfirmedCount: 0,
    };
  }

  // Compute directional bias
  let weightedSum = 0;
  let totalWeight = 0;
  const factors: EventFactor[] = [];

  for (const event of active) {
    const typeWeight = EVENT_IMPACT_WEIGHTS[event.type] ?? 0.3;
    const impactDir = IMPACT_DIRECTION[event.impact] ?? 0;
    const weight = typeWeight * event.confidence * event.relevance;

    const lean = impactDir;
    weightedSum += lean * weight;
    totalWeight += weight;

    factors.push({
      label: event.headline,
      lean,
      weight,
      sourceEventIds: [event.id],
      detail: event.summary,
    });
  }

  const directionalBias = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Confidence from event agreement
  const leans = active.map((e) => IMPACT_DIRECTION[e.impact] ?? 0);
  const leanStd = leans.length > 1 ? stddev(leans) : 0.5;
  const agreement = Math.max(0, 1 - leanStd);
  const avgConfidence = mean(active.map((e) => e.confidence));
  const confidence = avgConfidence * 0.6 + agreement * 0.4;

  // Uncertainty inversely related to agreement and confirmation
  const confirmedEvents = active.filter((e) => e.confirmation === "confirmed");
  const confirmationRatio = active.length > 0 ? confirmedEvents.length / active.length : 0;
  const uncertainty = Math.max(0.1, 1 - confidence * 0.5 - confirmationRatio * 0.3);

  // Veto check: high-confidence contradicting events
  let veto = false;
  let vetoReason: string | null = null;
  const contradictingEvents = active.filter((e) => {
    const eLean = IMPACT_DIRECTION[e.impact] ?? 0;
    return side === "long" ? eLean < -0.5 : eLean > 0.5;
  });
  const strongContradictions = contradictingEvents.filter((e) => e.confidence > 0.7);
  if (strongContradictions.length >= 2) {
    veto = true;
    vetoReason = `Multiple high-confidence contradicting events: ${strongContradictions.map((e) => e.headline).join("; ")}`;
  }

  return {
    symbol,
    activeEvents: active,
    directionalBias,
    confidence,
    uncertainty,
    factors: factors.sort((a, b) => b.weight - a.weight).slice(0, 10),
    veto,
    vetoReason,
    generatedAt: now,
    eventCount: active.length,
    confirmedCount: confirmedEvents.length,
    unconfirmedCount: active.filter((e) => e.confirmation === "unconfirmed").length,
  };
}

// ── Event Confirmation Check ──────────────────────────────

/**
 * Check if market price/volume behavior confirms an event's expected impact.
 * Uses post-event candles to measure actual price reaction.
 */
export function checkEventConfirmation(
  event: MarketEvent,
  postEventCandles: Candle[],
  now: number,
): EventConfirmation {
  if (postEventCandles.length === 0) return "insufficient_data";

  // Need at least 4 candles (1 hour on 15m) for confirmation
  if (postEventCandles.length < 4) return "insufficient_data";

  const eventPrice = postEventCandles[0].open;
  const currentPrice = postEventCandles[postEventCandles.length - 1].close;

  if (eventPrice <= 0) return "insufficient_data";

  const actualMove = (currentPrice - eventPrice) / eventPrice;
  const expectedDirection = IMPACT_DIRECTION[event.impact];

  // How much did we expect the price to move?
  const expectedMagnitude = Math.abs(expectedDirection) * 0.01; // ~1% for highly bullish/bearish

  if (Math.abs(actualMove) < 0.002) {
    // Very small move — insufficient data
    return "insufficient_data";
  }

  // Check direction match
  const directionMatch = (expectedDirection > 0 && actualMove > 0) ||
    (expectedDirection < 0 && actualMove < 0);

  if (directionMatch) {
    if (Math.abs(actualMove) >= expectedMagnitude * 0.8) {
      return "confirmed";
    }
    return "partially_confirmed";
  }

  // Direction contradicts
  if (Math.abs(actualMove) > expectedMagnitude * 0.5) {
    return "contradicted";
  }

  return "unconfirmed";
}

// ── Event Store Management ────────────────────────────────

export function storeEvent(event: MarketEvent): void {
  eventStore.set(event.id, event);
  pruneExpiredEvents();
}

export function getActiveEvents(symbol?: string): MarketEvent[] {
  const now = Date.now();
  const events = Array.from(eventStore.values()).filter(
    (e) => e.expiresAt > now,
  );
  if (symbol) {
    return events.filter((e) =>
      e.affectedAssets.some((a) => a.symbol === symbol || symbol.includes(a.symbol)),
    );
  }
  return events;
}

export function pruneExpiredEvents(): void {
  const now = Date.now();
  for (const [id, event] of eventStore) {
    if (event.expiresAt <= now) {
      eventStore.delete(id);
    }
  }
  // Also enforce max size
  if (eventStore.size > config.maxEvents) {
    const sorted = Array.from(eventStore.values()).sort((a, b) => a.detectedAt - b.detectedAt);
    const toRemove = sorted.slice(0, eventStore.size - config.maxEvents);
    for (const e of toRemove) {
      eventStore.delete(e.id);
    }
  }
}

export function updateEventConfig(partial: Partial<EventCollectorConfig>): void {
  config = { ...config, ...partial };
}

export function getEventStore(): Map<string, MarketEvent> {
  return eventStore;
}

export function resetEventStore(): void {
  eventStore.clear();
  eventCounter = 0;
}

// ── Helpers ───────────────────────────────────────────────

function createEvent(params: {
  type: EventType;
  headline: string;
  summary: string;
  affectedAssets: AffectedAsset[];
  impact: EventImpact;
  confidence: number;
  evidence: EventEvidence[];
  tags: string[];
  relevance: number;
}): MarketEvent {
  const now = Date.now();
  return {
    id: generateEventId(),
    type: params.type,
    headline: params.headline,
    summary: params.summary,
    source: "market_analysis",
    publishedAt: now,
    detectedAt: now,
    affectedAssets: params.affectedAssets,
    impact: params.impact,
    confidence: params.confidence,
    confirmation: "unconfirmed",
    evidence: params.evidence,
    tags: params.tags,
    relevance: params.relevance,
    expiresAt: now + config.eventTtlMs,
  };
}

function computeATR(candles: Candle[], period: number): number {
  if (candles.length < 2) return 0;
  let atr = 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    trs.push(tr);
  }
  if (trs.length < period) return trs.length > 0 ? mean(trs) : 0;
  atr = mean(trs.slice(0, period));
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}
