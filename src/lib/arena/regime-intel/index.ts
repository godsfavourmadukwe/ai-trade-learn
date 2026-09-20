// ============================================================
// MARKET REGIME INTELLIGENCE — Main Orchestrator
//
// The RegimeIntelligence class orchestrates:
// 1. Feature extraction from OHLCV data
// 2. Multi-timeframe regime classification with confidence
// 3. Regime transition detection and history
// 4. Strategy-aware filtering and adjustment
//
// Integration points:
// - Used by the arena engine to inform trade decisions
// - Feeds into the Decision Fusion Engine
// - Provides strategy adjustments for position sizing/TP/SL
// - Tracks regime history for analysis and reporting
// ============================================================

import type { Candle } from "@/lib/market/types";
import type { TradeSide } from "@/lib/arena/types";
import type {
  ExtendedRegime,
  RegimeHistoryEntry,
  RegimeIntelConfig,
  RegimeTransition,
  StrategyAdjustments,
} from "./types";
import type { RegimeIntelligence } from "./types";
import { DEFAULT_REGIME_INTEL_CONFIG, EXTENDED_TO_BASE_REGIME } from "./types";

export type { RegimeIntelligence } from "./types";
import { extractRegimeFeatures } from "./features";
import { classifyRegimeMTF } from "./classifier";
import { RegimeTransitionDetector } from "./transitions";
import { computeStrategyAdjustments } from "./strategy-filter";

// ── Regime Intelligence Engine ─────────────────────────────

export class RegimeIntelligenceEngine {
  private config: RegimeIntelConfig;
  private detectors: Map<string, RegimeTransitionDetector> = new Map();
  private latestIntel: Map<string, RegimeIntelligence> = new Map();

  constructor(config?: Partial<RegimeIntelConfig>) {
    this.config = { ...DEFAULT_REGIME_INTEL_CONFIG, ...config };
  }

  /**
   * Update configuration.
   */
  updateConfig(partial: Partial<RegimeIntelConfig>): void {
    Object.assign(this.config, partial);
  }

  /**
   * Analyze regime for a specific symbol.
   *
   * @param symbol - Normalized symbol (e.g. "BTC/USDT")
   * @param candles15m - Primary timeframe candles
   * @param candles1h - Higher timeframe candles
   * @param livePrice - Current price
   * @param priceHistory - Recent price ticks
   * @param now - Current timestamp
   * @returns Full regime intelligence output
   */
  analyze(
    symbol: string,
    candles15m: Candle[],
    candles1h: Candle[],
    livePrice: number,
    priceHistory: number[],
    now: number,
  ): RegimeIntelligence | null {
    // Get or create detector for this symbol
    let detector = this.detectors.get(symbol);
    if (!detector) {
      detector = new RegimeTransitionDetector(this.config);
      this.detectors.set(symbol, detector);
    }

    // ── 1. Extract features ──────────────────────────────

    const features = extractRegimeFeatures(candles15m, candles1h, livePrice, priceHistory);
    if (!features) return null;

    // ── 2. Multi-timeframe classification ────────────────

    const classification = classifyRegimeMTF(
      candles15m, candles1h, livePrice, priceHistory, this.config,
    );
    if (!classification) return null;

    const { regime, confidence, features: classifiedFeatures } = classification;

    // ── 3. Detect transitions ────────────────────────────

    const {
      transition,
      isDisordered,
      stabilityScore,
      timeSinceLastTransition,
    } = detector.processClassification(
      regime, confidence, classifiedFeatures, livePrice, now,
    );

    // ── 4. Handle disordered state ───────────────────────

    const effectiveRegime: ExtendedRegime = isDisordered ? "disordered" : regime;

    // ── 5. Compute suitability ───────────────────────────

    const suitabilityScore = computeRegimeSuitabilityScore(effectiveRegime, features);
    const suitableForTrading = suitabilityScore > 0.3 && confidence.overall > 0.4;

    // ── 6. Get recent transitions ────────────────────────

    const recentTransitions = detector.getRecentTransitions(now);

    // ── 7. Build output ──────────────────────────────────

    const higherTimeframeRegime = classification.features.candleCount > 0
      ? classifyRegimeMTF(candles1h, [], livePrice, priceHistory, this.config)?.regime ?? null
      : null;

    const higherTimeframeConfirmed = confidence.multiTimeframeConfirmed;

    const intel: RegimeIntelligence = {
      regime: effectiveRegime,
      confidence,
      features: classifiedFeatures,
      baseRegime: EXTENDED_TO_BASE_REGIME[effectiveRegime],
      suitableForTrading,
      suitabilityScore,
      recentTransitions,
      timeSinceLastTransition,
      stabilityScore,
      strategyAdjustments: computeStrategyAdjustments(
        {
          regime: effectiveRegime,
          confidence,
          features: classifiedFeatures,
          baseRegime: EXTENDED_TO_BASE_REGIME[effectiveRegime],
          suitableForTrading,
          suitabilityScore,
          recentTransitions,
          timeSinceLastTransition,
          stabilityScore,
          strategyAdjustments: { ...DEFAULT_STRATEGY_ADJUSTMENTS },
          analyzedAt: now,
          higherTimeframeRegime,
          higherTimeframeConfirmed,
        },
        "long",
      ),
      analyzedAt: now,
      higherTimeframeRegime,
      higherTimeframeConfirmed,
    };

    this.latestIntel.set(symbol, intel);
    return intel;
  }

  /**
   * Get strategy adjustments for a specific side.
   */
  getStrategyAdjustments(
    symbol: string,
    side: TradeSide,
  ): StrategyAdjustments | null {
    const intel = this.latestIntel.get(symbol);
    if (!intel) return null;
    return computeStrategyAdjustments(intel, side);
  }

  /**
   * Get latest regime intelligence for a symbol.
   */
  getLatest(symbol: string): RegimeIntelligence | null {
    return this.latestIntel.get(symbol) ?? null;
  }

  /**
   * Get all latest regime intel.
   */
  getAllLatest(): Map<string, RegimeIntelligence> {
    return new Map(this.latestIntel);
  }

  /**
   * Get regime history for a symbol.
   */
  getHistory(symbol: string): RegimeHistoryEntry[] {
    return this.detectors.get(symbol)?.getHistory() ?? [];
  }

  /**
   * Get all transitions for a symbol.
   */
  getTransitions(symbol: string): RegimeTransition[] {
    return this.detectors.get(symbol)?.getTransitions() ?? [];
  }

  /**
   * Get regime distribution over a time window.
   */
  getRegimeDistribution(
    symbol: string,
    now: number,
    windowMs: number,
  ): Map<ExtendedRegime, number> | null {
    return this.detectors.get(symbol)?.getRegimeDistribution(now, windowMs) ?? null;
  }

  /**
   * Reset state for a symbol.
   */
  resetSymbol(symbol: string): void {
    this.detectors.get(symbol)?.reset();
    this.latestIntel.delete(symbol);
  }

  /**
   * Reset all state.
   */
  resetAll(): void {
    for (const detector of this.detectors.values()) {
      detector.reset();
    }
    this.detectors.clear();
    this.latestIntel.clear();
  }
}

// ── Suitability Score ──────────────────────────────────────

function computeRegimeSuitabilityScore(
  regime: ExtendedRegime,
  features: {
    trendStrength: number;
    volatilityLevel: number;
    adx: number;
  },
): number {
  const SUITABILITY: Record<ExtendedRegime, number> = {
    strong_uptrend: 0.9,
    uptrend: 0.75,
    weak_uptrend: 0.5,
    strong_downtrend: 0.9,
    downtrend: 0.75,
    weak_downtrend: 0.5,
    range: 0.3,
    breakout: 0.8,
    breakdown: 0.8,
    high_volatility: 0.1,
    low_volatility: 0.2,
    transition: 0.25,
    disordered: 0.05,
    unknown: 0.2,
  };

  let score = SUITABILITY[regime];

  // Adjust based on features
  if (features.trendStrength > 0.6 && (regime.includes("uptrend") || regime.includes("downtrend"))) {
    score = Math.min(1, score + 0.1);
  }

  if (features.volatilityLevel > 0.9) {
    score *= 0.5; // severely reduce in extreme volatility
  }

  return Math.max(0, Math.min(1, score));
}

// ── Default Strategy Adjustments ───────────────────────────

const DEFAULT_STRATEGY_ADJUSTMENTS: StrategyAdjustments = {
  positionSizeMultiplier: 1.0,
  takeProfitMultiplier: 1.0,
  stopLossMultiplier: 1.0,
  additionalConfidenceRequired: 0,
  avoidLongs: false,
  avoidShorts: false,
  maxPositions: 1,
  tightenRisk: false,
  reason: "Default adjustments",
};

// ── Module-level singleton ──────────────────────────────────

export const regimeIntelEngine = new RegimeIntelligenceEngine();
