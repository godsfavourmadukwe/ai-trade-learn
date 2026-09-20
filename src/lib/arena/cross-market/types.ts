// ============================================================
// AI TRADE ARENA — Cross-Market Intelligence Types
//
// A separate intelligence layer that examines correlated /
// related markets available from the existing providers and
// produces CONFIRM / CONTRADICT / NEUTRAL context for any pair.
//
// Feeds into the existing signal-validation (fusion) engine as
// evidence + optional veto. Never forces a trade.
// ============================================================

/** Verdict the context engine produces relative to a pair's setup. */
export type CrossMarketVerdict = "confirm" | "contradict" | "neutral" | "insufficient_data";

/** How each cross-market factor leaned relative to the setup. */
export type FactorLean = "confirm" | "contradict" | "neutral" | "unavailable";

/** A related market that the engine examined for context. */
export interface RelatedMarket {
  /** Exchange-native symbol, e.g. "ETHUSDT". */
  exchangeSymbol: string;
  /** Display symbol, e.g. "ETH/USDT". */
  symbol: string;
  /** Why this market was selected as related (computed, not hardcoded). */
  reason: string;
  /** Pearson correlation of 1h returns vs the target pair (null if unknown). */
  correlation: number | null;
  /** 24h percent change of the related market. */
  change24hPercent: number;
  /** 24h quote volume. */
  quoteVolume24h: number;
  /** Realized volatility of 1h returns over the lookback. */
  volatility: number | null;
}

/** Breadth of the market measured across the dynamically selected universe. */
export interface MarketBreadth {
  /** Number of markets measured. */
  measuredCount: number;
  /** Fraction (0-1) of measured markets up over 24h. */
  advancingRatio: number;
  /** Mean 24h change across the universe (%). */
  meanChange24h: number;
  /** Median 24h change across the universe (%). */
  medianChange24h: number;
  /** Fraction of markets with |change| > 5% (disorder proxy). */
  extremeMoveRatio: number;
  /** Cross-sectional dispersion of 24h returns (std dev, %). */
  dispersion: number;
}

/** Volatility state of the broader market (relative to its own history). */
export interface MarketVolatilityState {
  /** Mean realized vol of correlated markets. */
  correlatedMeanVol: number;
  /** Volatility of the target pair. */
  targetVol: number;
  /** targetVol / correlatedMeanVol (1 = in line). */
  relativeVol: number | null;
  /** "calm" | "normal" | "elevated" | "extreme" based on relative vol. */
  level: "calm" | "normal" | "elevated" | "extreme";
}

/** Correlation-strength classification for a related market. */
export type CorrelationStrength = "strong" | "moderate" | "weak" | "unknown";

/** Weighted composite factors used to reach a verdict. */
export interface CrossMarketFactor {
  factor: string;
  lean: FactorLean;
  /** Contribution weight (already normalized, 0-1). */
  weight: number;
  /** Human-readable explanation. */
  detail: string;
  /** Supporting metrics. */
  metrics: Record<string, number>;
}

/** Full cross-market context output for one pair at one time. */
export interface CrossMarketContext {
  /** Display symbol the context is for. */
  symbol: string;
  /** Exchange-native symbol. */
  exchangeSymbol: string;
  /** Trade side the verdict is relative to. */
  side: "long" | "short";
  /** CONFIRM / CONTRADICT / NEUTRAL / insufficient data. */
  verdict: CrossMarketVerdict;
  /** Overall confidence in the verdict 0-1. */
  confidence: number;
  /** How strongly the verdict leans 0-1. */
  strength: number;
  /** Weighted net score: >0 confirms, <0 contradicts. */
  score: number;
  /** The factor breakdown behind the verdict. */
  factors: CrossMarketFactor[];
  /** Markets examined (dynamically selected). */
  relatedMarkets: RelatedMarket[];
  /** Market-wide breadth snapshot. */
  breadth: MarketBreadth | null;
  /** Broader volatility state. */
  volatility: MarketVolatilityState | null;
  /** Market-wide trend lean derived from the universe. */
  marketTrend: "risk_on" | "risk_off" | "mixed" | "unknown";
  /** Whether verdict is based on live, fresh-enough data. */
  dataFresh: boolean;
  /** Whether data was available at all. */
  dataAvailable: boolean;
  /** Human-readable summary. */
  summary: string;
  /** When computed (epoch ms). */
  computedAt: number;
}

/** A single relative-strength observation for a related market. */
export interface RelativeStrength {
  symbol: string;
  /** target 24h change − related 24h change (percentage points). */
  spread: number;
}

/** Core pure-analysis interface (kept minimal for testability). */
export interface CrossMarketInput {
  /** Target pair (exchange-native). */
  exchangeSymbol: string;
  /** Display symbol. */
  symbol: string;
  /** Side of the proposed setup. */
  side: "long" | "short";
  /** Universe tickers (from the existing registry). */
  universe: Array<{
    exchangeSymbol: string;
    symbol: string;
    price: number;
    change24hPercent: number;
    quoteVolume24h: number;
  }>;
  /** Recent 1h returns per symbol (fraction, oldest→newest), for correlation. */
  returnSeries: Map<string, number[]>;
  /** Target pair's realized volatility (std of recent returns). */
  targetVolatility: number;
  /** now (epoch ms). */
  now: number;
}
