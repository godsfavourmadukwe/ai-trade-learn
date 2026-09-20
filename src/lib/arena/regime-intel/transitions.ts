// ============================================================
// MARKET REGIME INTELLIGENCE — Transition Detection
//
// Tracks regime changes over time, detects transitions,
// computes stability scores, and identifies disordered markets.
// ============================================================

import type {
  ExtendedRegime,
  RegimeConfidence,
  RegimeFeatures,
  RegimeHistoryEntry,
  RegimeIntelConfig,
  RegimeTransition,
} from "./types";

// ── Transition Detector ────────────────────────────────────

export class RegimeTransitionDetector {
  private history: RegimeHistoryEntry[] = [];
  private transitions: RegimeTransition[] = [];
  private config: RegimeIntelConfig;

  constructor(config: RegimeIntelConfig) {
    this.config = config;
  }

  /**
   * Process a new regime classification and detect transitions.
   * Returns the detected transition (if any) and updated state.
   */
  processClassification(
    regime: ExtendedRegime,
    confidence: RegimeConfidence,
    features: RegimeFeatures,
    price: number,
    now: number,
  ): {
    transition: RegimeTransition | null;
    isDisordered: boolean;
    stabilityScore: number;
    timeSinceLastTransition: number;
  } {
    const entry: RegimeHistoryEntry = {
      regime,
      confidence: confidence.overall,
      timestamp: now,
    };

    this.history.push(entry);

    // Trim history
    if (this.history.length > this.config.maxHistoryEntries) {
      this.history = this.history.slice(-this.config.maxHistoryEntries);
    }

    // Check for transition
    let transition: RegimeTransition | null = null;

    if (this.history.length >= 2) {
      const prev = this.history[this.history.length - 2];
      const curr = this.history[this.history.length - 1];

      if (prev.regime !== curr.regime) {
        // A regime change occurred
        transition = {
          from: prev.regime,
          to: curr.regime,
          detectedAt: now,
          priceAtTransition: price,
          confidence: (prev.confidence + curr.confidence) / 2,
          features,
          previousConfidence: {
            overall: prev.confidence,
            trendConfidence: 0,
            volatilityConfidence: 0,
            momentumConfidence: 0,
            volumeConfidence: 0,
            dataPoints: features.candleCount,
            multiTimeframeConfirmed: false,
            timeframeAgreement: 0,
          },
          newConfidence: { ...confidence },
        };

        this.transitions.push(transition);

        // Trim transitions
        if (this.transitions.length > this.config.maxTransitionHistory) {
          this.transitions = this.transitions.slice(-this.config.maxTransitionHistory);
        }
      }
    }

    // Check for disordered state (too many transitions in short window)
    const recentTransitions = this.getRecentTransitions(now);
    const isDisordered = recentTransitions.length >= this.config.maxTransitionsBeforeDisordered;

    // Compute stability score
    const stabilityScore = this.computeStabilityScore(now);

    // Time since last transition
    const timeSinceLastTransition = this.transitions.length > 0
      ? now - this.transitions[this.transitions.length - 1].detectedAt
      : now - (this.history[0]?.timestamp ?? now);

    return {
      transition,
      isDisordered,
      stabilityScore,
      timeSinceLastTransition,
    };
  }

  /**
   * Get transitions within a time window.
   */
  getRecentTransitions(now: number): RegimeTransition[] {
    const cutoff = now - this.config.transitionWindowMs;
    return this.transitions.filter(t => t.detectedAt >= cutoff);
  }

  /**
   * Compute stability score: 0 = very unstable, 1 = very stable.
   * Based on:
   * - Number of transitions in recent window
   * - Confidence consistency
   * - Time since last transition
   */
  computeStabilityScore(now: number): number {
    if (this.history.length < 5) return 0.5; // insufficient data

    const recentHistory = this.history.slice(-20);
    const recentTransitions = this.getRecentTransitions(now);

    // Factor 1: Transition frequency (fewer = more stable)
    const transitionRate = recentTransitions.length / Math.max(1, recentHistory.length);
    const frequencyScore = Math.max(0, 1 - transitionRate * 3);

    // Factor 2: Confidence consistency
    const avgConfidence = recentHistory.reduce((s, h) => s + h.confidence, 0) / recentHistory.length;
    const confidenceVariance = recentHistory.reduce(
      (s, h) => s + (h.confidence - avgConfidence) ** 2, 0,
    ) / recentHistory.length;
    const consistencyScore = Math.max(0, 1 - confidenceVariance * 10);

    // Factor 3: Time since last transition (longer = more stable)
    const lastTransition = this.transitions[this.transitions.length - 1];
    const timeSinceMs = lastTransition ? now - lastTransition.detectedAt : this.config.transitionWindowMs;
    const timeScore = Math.min(1, timeSinceMs / this.config.transitionWindowMs);

    // Weighted average
    return frequencyScore * 0.4 + consistencyScore * 0.3 + timeScore * 0.3;
  }

  /**
   * Get current regime without a recent transition.
   * Returns the last regime if confidence is above threshold.
   */
  getCurrentSettledRegime(): ExtendedRegime | null {
    if (this.history.length === 0) return null;

    const last = this.history[this.history.length - 1];
    if (last.confidence >= this.config.minConfidenceForSettled) {
      return last.regime;
    }

    return null;
  }

  /**
   * Get all transitions.
   */
  getTransitions(): RegimeTransition[] {
    return [...this.transitions];
  }

  /**
   * Get regime history.
   */
  getHistory(): RegimeHistoryEntry[] {
    return [...this.history];
  }

  /**
   * Get regime distribution over a time window.
   */
  getRegimeDistribution(now: number, windowMs: number): Map<ExtendedRegime, number> {
    const cutoff = now - windowMs;
    const entries = this.history.filter(h => h.timestamp >= cutoff);
    const dist = new Map<ExtendedRegime, number>();

    for (const entry of entries) {
      dist.set(entry.regime, (dist.get(entry.regime) ?? 0) + 1);
    }

    return dist;
  }

  /**
   * Reset state.
   */
  reset(): void {
    this.history = [];
    this.transitions = [];
  }
}
