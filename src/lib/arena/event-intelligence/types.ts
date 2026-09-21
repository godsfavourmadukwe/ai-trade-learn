// ============================================================
// AI TRADE ARENA — Event Intelligence Types
//
// Real-time research and event intelligence layer.
// Collects, classifies, and scores market events to provide
// context that feeds into the existing analysis pipeline.
//
// NEVER allows headlines alone to generate trades.
// IGNORES data that is unavailable or stale.
// ============================================================

// ── Event Classification ──────────────────────────────────

export type EventType =
  | "exchange_announcement"
  | "regulatory_news"
  | "macroeconomic"
  | "earnings"
  | "protocol_upgrade"
  | "partnership"
  | "security_incident"
  | "whale_movement"
  | "liquidity_change"
  | "index_rebalance"
  | "etf_approval"
  | "market_commentary"
  | "social_sentiment"
  | "technical_alert"
  | "other";

export type EventImpact =
  | "highly_bullish"
  | "bullish"
  | "slightly_bullish"
  | "neutral"
  | "slightly_bearish"
  | "bearish"
  | "highly_bearish";

export type EventConfirmation =
  | "confirmed"       // price/volume behavior matches expected impact
  | "partially_confirmed"  // some confirmation but not complete
  | "unconfirmed"     // no price/volume confirmation yet
  | "contradicted"    // market moved opposite to event direction
  | "insufficient_data";  // too early to judge

// ── Core Event ────────────────────────────────────────────

/** A single market event detected by the event intelligence system. */
export interface MarketEvent {
  /** Unique event identifier. */
  id: string;
  /** Event type classification. */
  type: EventType;
  /** Human-readable headline/title. */
  headline: string;
  /** Detailed summary of the event. */
  summary: string;
  /** Source URL or description of where this event was found. */
  source: string;
  /** When the event was originally published. */
  publishedAt: number;
  /** When the event was detected by the system. */
  detectedAt: number;
  /** Assets potentially affected by this event. */
  affectedAssets: AffectedAsset[];
  /** Overall market impact assessment. */
  impact: EventImpact;
  /** Confidence in the impact assessment (0-1). */
  confidence: number;
  /** Whether the market has confirmed the expected impact. */
  confirmation: EventConfirmation;
  /** Supporting evidence for the impact assessment. */
  evidence: EventEvidence[];
  /** Tags for categorization and filtering. */
  tags: string[];
  /** Relevance score for a specific asset (0-1). */
  relevance: number;
  /** Expiration time — events become stale after this. */
  expiresAt: number;
}

/** An asset affected by a market event. */
export interface AffectedAsset {
  /** Symbol (e.g. "BTC", "ETH", "BTC/USDT"). */
  symbol: string;
  /** How directly this asset is affected. */
  directness: "direct" | "indirect" | "sector_wide";
  /** Expected impact on this specific asset. */
  expectedImpact: EventImpact;
  /** Confidence for this asset specifically (0-1). */
  confidence: number;
}

/** A piece of evidence supporting an event's impact assessment. */
export interface EventEvidence {
  /** Evidence type. */
  type: "price_reaction" | "volume_spike" | "spread_change" | "correlation_shift" | "historical_analogy" | "source_credibility" | "market_consensus";
  /** Description of this evidence. */
  description: string;
  /** Strength of this evidence (0-1). */
  strength: number;
  /** Supporting data points. */
  dataPoints: Record<string, number>;
}

// ── Event Intelligence Output ─────────────────────────────

/** Aggregated event intelligence for a specific symbol. */
export interface EventIntelligence {
  /** The symbol this intelligence is for. */
  symbol: string;
  /** Active (non-expired) events relevant to this symbol. */
  activeEvents: MarketEvent[];
  /** Net directional bias from events (-1 bearish to +1 bullish). */
  directionalBias: number;
  /** Confidence in the aggregate bias (0-1). */
  confidence: number;
  /** Overall uncertainty from events (0-1). */
  uncertainty: number;
  /** Key factors driving the event bias. */
  factors: EventFactor[];
  /** Whether any high-confidence events should veto trading. */
  veto: boolean;
  /** Reason for veto if applicable. */
  vetoReason: string | null;
  /** Timestamp of this intelligence snapshot. */
  generatedAt: number;
  /** How many events contributed to this assessment. */
  eventCount: number;
  /** Number of confirmed vs unconfirmed events. */
  confirmedCount: number;
  unconfirmedCount: number;
}

/** A factor contributing to event intelligence. */
export interface EventFactor {
  /** Factor name/description. */
  label: string;
  /** Directional lean (-1 to +1). */
  lean: number;
  /** Weight of this factor (0-1). */
  weight: number;
  /** Source event ID(s). */
  sourceEventIds: string[];
  /** Human-readable detail. */
  detail: string;
}

// ── Collector Configuration ───────────────────────────────

export interface EventCollectorConfig {
  /** Maximum number of events to retain in memory. */
  maxEvents: number;
  /** Event TTL in ms — events older than this are expired. */
  eventTtlMs: number;
  /** Minimum confidence threshold to include an event. */
  minConfidence: number;
  /** Maximum age of events to fetch (ms). */
  maxEventAgeMs: number;
  /** How often to refresh events (ms). */
  refreshIntervalMs: number;
  /** Asset universe for event filtering. */
  assetUniverse: string[];
}

/** Default configuration. */
export const DEFAULT_EVENT_COLLECTOR_CONFIG: EventCollectorConfig = {
  maxEvents: 500,
  eventTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  minConfidence: 0.3,
  maxEventAgeMs: 48 * 60 * 60 * 1000, // 48 hours
  refreshIntervalMs: 5 * 60 * 1000, // 5 minutes
  assetUniverse: ["BTC", "ETH", "SOL", "USDT", "BNB", "XRP", "ADA", "DOGE"],
};

// ── Event Scoring ─────────────────────────────────────────

/** Impact weight table for different event types. */
export const EVENT_IMPACT_WEIGHTS: Record<EventType, number> = {
  exchange_announcement: 0.7,
  regulatory_news: 0.9,
  macroeconomic: 0.8,
  earnings: 0.85,
  protocol_upgrade: 0.75,
  partnership: 0.5,
  security_incident: 0.95,
  whale_movement: 0.6,
  liquidity_change: 0.65,
  index_rebalance: 0.7,
  etf_approval: 0.95,
  market_commentary: 0.3,
  social_sentiment: 0.4,
  technical_alert: 0.5,
  other: 0.3,
};

/** Impact directional multipliers. */
export const IMPACT_DIRECTION: Record<EventImpact, number> = {
  highly_bullish: 1.0,
  bullish: 0.6,
  slightly_bullish: 0.3,
  neutral: 0.0,
  slightly_bearish: -0.3,
  bearish: -0.6,
  highly_bearish: -1.0,
};
