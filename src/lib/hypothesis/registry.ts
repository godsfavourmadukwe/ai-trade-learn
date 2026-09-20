// ============================================================
// AI HYPOTHESIS LABORATORY — Hypothesis Registry
//
// In-memory storage for all hypotheses and their test results.
// Provides query APIs for filtering, ranking, and managing
// hypotheses throughout their lifecycle.
//
// Lifecycle:
//   draft → testing → validated/rejected → promoted
//
// Never deploys hypotheses directly to trading.
// Only validated candidates can enter the strategy system.
// ============================================================

import type {
  Hypothesis,
  HypothesisTestResult,
  HypothesisStatus,
  StrategyPromotion,
  ValidationResult,
} from "./types";

export class HypothesisRegistry {
  private hypotheses = new Map<string, Hypothesis>();
  private testResults = new Map<string, HypothesisTestResult>();
  private promotions = new Map<string, StrategyPromotion>();

  // ── CRUD ──────────────────────────────────────────────────

  /** Register a new hypothesis. */
  add(hypothesis: Hypothesis): void {
    this.hypotheses.set(hypothesis.id, hypothesis);
  }

  /** Get a hypothesis by ID. */
  get(id: string): Hypothesis | undefined {
    return this.hypotheses.get(id);
  }

  /** Update hypothesis status. */
  updateStatus(id: string, status: HypothesisStatus): void {
    const h = this.hypotheses.get(id);
    if (h) h.status = status;
  }

  /** Store a test result for a hypothesis. */
  storeTestResult(result: HypothesisTestResult): void {
    this.testResults.set(result.hypothesisId, result);
    const h = this.hypotheses.get(result.hypothesisId);
    if (h) {
      h.lastTestedAt = result.completedAt;
      h.status = result.validationResult.verdict === "passed" ? "validated" : "rejected";
    }
  }

  /** Get the test result for a hypothesis. */
  getTestResult(id: string): HypothesisTestResult | undefined {
    return this.testResults.get(id);
  }

  // ── Queries ───────────────────────────────────────────────

  /** Get all hypotheses. */
  listAll(): Hypothesis[] {
    return Array.from(this.hypotheses.values());
  }

  /** Get hypotheses filtered by status. */
  listByStatus(status: HypothesisStatus): Hypothesis[] {
    return this.listAll().filter(h => h.status === status);
  }

  /** Get validated hypotheses ready for promotion. */
  listValidated(): Hypothesis[] {
    return this.listByStatus("validated");
  }

  /** Get promoted hypotheses. */
  listPromoted(): Hypothesis[] {
    return this.listByStatus("promoted");
  }

  /** Get hypotheses by category. */
  listByCategory(category: string): Hypothesis[] {
    return this.listAll().filter(h => h.category === category);
  }

  /** Get hypotheses by symbol. */
  listBySymbol(symbol: string): Hypothesis[] {
    return this.listAll().filter(h => h.symbol === symbol);
  }

  /** Rank validated hypotheses by performance. */
  rankByPerformance(): { hypothesis: Hypothesis; result: HypothesisTestResult }[] {
    const validated = this.listValidated();
    const ranked: { hypothesis: Hypothesis; result: HypothesisTestResult }[] = [];

    for (const h of validated) {
      const result = this.testResults.get(h.id);
      if (result) ranked.push({ hypothesis: h, result });
    }

    // Sort by OOS Sharpe (primary) then validation score (secondary)
    ranked.sort((a, b) => {
      const sharpeA = a.result.outOfSample.sharpeRatio;
      const sharpeB = b.result.outOfSample.sharpeRatio;
      if (sharpeB !== sharpeA) return sharpeB - sharpeA;
      return b.result.validationResult.overallScore - a.result.validationResult.overallScore;
    });

    return ranked;
  }

  // ── Promotions ────────────────────────────────────────────

  /** Promote a validated hypothesis to the strategy system. */
  promote(hypothesisId: string, strategyId: string, parameters: Record<string, number>): StrategyPromotion | null {
    const h = this.hypotheses.get(hypothesisId);
    if (!h || h.status !== "validated") return null;

    const promotion: StrategyPromotion = {
      hypothesisId,
      hypothesisVersion: h.version,
      strategyId,
      parameters,
      promotedAt: Date.now(),
      active: true,
    };

    this.promotions.set(hypothesisId, promotion);
    h.status = "promoted";
    return promotion;
  }

  /** Get all active promotions. */
  getActivePromotions(): StrategyPromotion[] {
    return Array.from(this.promotions.values()).filter(p => p.active);
  }

  /** Deactivate a promotion. */
  deactivatePromotion(hypothesisId: string): void {
    const p = this.promotions.get(hypothesisId);
    if (p) p.active = false;
  }

  // ── Statistics ────────────────────────────────────────────

  /** Get summary statistics. */
  getStats(): {
    total: number;
    byStatus: Record<HypothesisStatus, number>;
    totalPromoted: number;
    avgOosSharpe: number;
    avgValidationScore: number;
  } {
    const all = this.listAll();
    const byStatus: Record<HypothesisStatus, number> = {
      draft: 0, testing: 0, validated: 0, rejected: 0, promoted: 0,
    };
    for (const h of all) byStatus[h.status]++;

    const validated = this.listValidated();
    const oosSharpes = validated.map(h => this.testResults.get(h.id)?.outOfSample.sharpeRatio ?? 0);
    const valScores = validated.map(h => this.testResults.get(h.id)?.validationResult.overallScore ?? 0);

    return {
      total: all.length,
      byStatus,
      totalPromoted: this.listPromoted().length,
      avgOosSharpe: oosSharpes.length > 0 ? oosSharpes.reduce((a, b) => a + b, 0) / oosSharpes.length : 0,
      avgValidationScore: valScores.length > 0 ? valScores.reduce((a, b) => a + b, 0) / valScores.length : 0,
    };
  }

  /** Clear all data. */
  clear(): void {
    this.hypotheses.clear();
    this.testResults.clear();
    this.promotions.clear();
  }
}

// Module-level singleton
export const hypothesisRegistry = new HypothesisRegistry();
