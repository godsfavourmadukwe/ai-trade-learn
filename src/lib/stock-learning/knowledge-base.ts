// ============================================================
// STOCK MARKET LEARNING — Stock Knowledge Base
//
// Continuously expanding knowledge base containing validated
// information about stocks and market behavior.
//
// Tracks: patterns discovered, strategies tested, performance
// statistics, market regimes, successful/failed hypotheses.
//
// Every change is versioned, measurable, and reversible.
// Knowledge flows FORWARD ONLY — never contaminated by
// the conversational AI.
// ============================================================

import type {
  KnowledgeEntry,
  KnowledgeType,
  KnowledgePattern,
  KnowledgePerformance,
  KnowledgeVersion,
  KnowledgeChange,
} from "./types";
import type { MarketRegime } from "@/lib/arena/types";

// ── Knowledge Store ───────────────────────────────────────

const knowledgeStore = new Map<string, KnowledgeEntry>();
const versionHistory: KnowledgeVersion[] = [];
let currentVersion = 1;

// ── Knowledge ID Generation ───────────────────────────────

let knowledgeCounter = 0;
function generateKnowledgeId(): string {
  knowledgeCounter++;
  return `kb_${Date.now()}_${knowledgeCounter}`;
}

// ── Core Knowledge Operations ─────────────────────────────

/**
 * Add a new knowledge entry to the base.
 */
export function addKnowledge(params: {
  type: KnowledgeType;
  symbol: string;
  name: string;
  description: string;
  pattern: KnowledgePattern;
  confidence: number;
  sampleSize: number;
  performance: KnowledgePerformance;
  applicableRegimes: MarketRegime[];
  conditions: string[];
  sourceEpisodeIds: string[];
}): KnowledgeEntry {
  const now = Date.now();
  const entry: KnowledgeEntry = {
    id: generateKnowledgeId(),
    type: params.type,
    symbol: params.symbol,
    name: params.name,
    description: params.description,
    pattern: params.pattern,
    confidence: params.confidence,
    sampleSize: params.sampleSize,
    performance: params.performance,
    applicableRegimes: params.applicableRegimes,
    conditions: params.conditions,
    version: 1,
    discoveredAt: now,
    lastValidatedAt: now,
    lastUpdatedAt: now,
    active: params.confidence >= 0.6,
    rejectionReason: null,
    sourceEpisodeIds: params.sourceEpisodeIds,
  };

  knowledgeStore.set(entry.id, entry);
  recordVersionChange("added", entry.id, entry.name, "New knowledge discovered");
  return entry;
}

/**
 * Update an existing knowledge entry.
 */
export function updateKnowledge(
  id: string,
  updates: Partial<Pick<KnowledgeEntry, "confidence" | "sampleSize" | "performance" | "description" | "applicableRegimes" | "conditions">>,
): KnowledgeEntry | null {
  const entry = knowledgeStore.get(id);
  if (!entry) return null;

  const changes: string[] = [];
  if (updates.confidence !== undefined && updates.confidence !== entry.confidence) {
    changes.push(`confidence: ${entry.confidence.toFixed(2)} → ${updates.confidence.toFixed(2)}`);
    entry.confidence = updates.confidence;
  }
  if (updates.sampleSize !== undefined) {
    changes.push(`sampleSize: ${entry.sampleSize} → ${updates.sampleSize}`);
    entry.sampleSize = updates.sampleSize;
  }
  if (updates.performance !== undefined) {
    entry.performance = updates.performance;
    changes.push("performance updated");
  }
  if (updates.description !== undefined) {
    entry.description = updates.description;
  }
  if (updates.applicableRegimes !== undefined) {
    entry.applicableRegimes = updates.applicableRegimes;
  }
  if (updates.conditions !== undefined) {
    entry.conditions = updates.conditions;
  }

  entry.version++;
  entry.lastUpdatedAt = Date.now();

  // Auto-deactivate if confidence drops too low
  if (entry.confidence < 0.4) {
    entry.active = false;
    entry.rejectionReason = "Confidence dropped below activation threshold";
  }

  recordVersionChange("updated", entry.id, entry.name, changes.join("; ") || "Minor update");
  return entry;
}

/**
 * Validate/revalidate a knowledge entry against new evidence.
 */
export function validateKnowledge(
  id: string,
  newPerformance: KnowledgePerformance,
  minConfidence: number = 0.6,
): { entry: KnowledgeEntry; passed: boolean } | null {
  const entry = knowledgeStore.get(id);
  if (!entry) return null;

  // Merge performance data
  const mergedPerf: KnowledgePerformance = {
    episodesTested: entry.performance.episodesTested + newPerformance.episodesTested,
    profitableEpisodes: entry.performance.profitableEpisodes + newPerformance.profitableEpisodes,
    avgReturn: (entry.performance.avgReturn * entry.performance.episodesTested + newPerformance.avgReturn * newPerformance.episodesTested) /
      (entry.performance.episodesTested + newPerformance.episodesTested || 1),
    bestReturn: Math.max(entry.performance.bestReturn, newPerformance.bestReturn),
    worstReturn: Math.min(entry.performance.worstReturn, newPerformance.worstReturn),
    avgSharpe: (entry.performance.avgSharpe * entry.performance.episodesTested + newPerformance.avgSharpe * newPerformance.episodesTested) /
      (entry.performance.episodesTested + newPerformance.episodesTested || 1),
    winRate: (entry.performance.winRate * entry.performance.episodesTested + newPerformance.winRate * newPerformance.episodesTested) /
      (entry.performance.episodesTested + newPerformance.episodesTested || 1),
    profitFactor: (entry.performance.profitFactor * entry.performance.episodesTested + newPerformance.profitFactor * newPerformance.episodesTested) /
      (entry.performance.episodesTested + newPerformance.episodesTested || 1),
    expectancy: (entry.performance.expectancy * entry.performance.episodesTested + newPerformance.expectancy * newPerformance.episodesTested) /
      (entry.performance.episodesTested + newPerformance.episodesTested || 1),
    maxDrawdown: Math.max(entry.performance.maxDrawdown, newPerformance.maxDrawdown),
  };

  // Recompute confidence from merged performance
  const passed = mergedPerf.winRate >= 0.45 &&
    mergedPerf.avgSharpe >= 0.5 &&
    mergedPerf.profitFactor >= 1.0 &&
    mergedPerf.episodesTested >= 3;

  const newConfidence = passed
    ? Math.min(1, 0.3 + mergedPerf.winRate * 0.3 + Math.min(mergedPerf.avgSharpe / 2, 0.3) + (mergedPerf.episodesTested / 20) * 0.1)
    : Math.max(0, entry.confidence - 0.1);

  entry.performance = mergedPerf;
  entry.confidence = newConfidence;
  entry.active = newConfidence >= minConfidence;
  entry.lastValidatedAt = Date.now();
  entry.version++;

  if (!entry.active && !entry.rejectionReason) {
    entry.rejectionReason = "Failed validation: insufficient performance after re-testing";
    recordVersionChange("invalidated", entry.id, entry.name, entry.rejectionReason);
  } else if (entry.active) {
    recordVersionChange("validated", entry.id, entry.name, `Re-validated: winRate=${(mergedPerf.winRate * 100).toFixed(0)}%, sharpe=${mergedPerf.avgSharpe.toFixed(2)}`);
  }

  return { entry, passed };
}

/**
 * Deactivate (soft-delete) a knowledge entry.
 */
export function deactivateKnowledge(id: string, reason: string): boolean {
  const entry = knowledgeStore.get(id);
  if (!entry) return false;

  entry.active = false;
  entry.rejectionReason = reason;
  entry.version++;
  entry.lastUpdatedAt = Date.now();

  recordVersionChange("removed", entry.id, entry.name, reason);
  return true;
}

// ── Knowledge Queries ─────────────────────────────────────

/**
 * Get all active knowledge for a symbol.
 */
export function getKnowledgeForSymbol(symbol: string): KnowledgeEntry[] {
  return Array.from(knowledgeStore.values()).filter(
    (e) => e.symbol === symbol && e.active,
  );
}

/**
 * Get knowledge applicable to a market regime.
 */
export function getKnowledgeForRegime(regime: MarketRegime): KnowledgeEntry[] {
  return Array.from(knowledgeStore.values()).filter(
    (e) => e.active && e.applicableRegimes.includes(regime),
  );
}

/**
 * Search knowledge by type.
 */
export function getKnowledgeByType(type: KnowledgeType): KnowledgeEntry[] {
  return Array.from(knowledgeStore.values()).filter((e) => e.type === type && e.active);
}

/**
 * Get top knowledge entries by confidence.
 */
export function getTopKnowledge(limit: number = 20): KnowledgeEntry[] {
  return Array.from(knowledgeStore.values())
    .filter((e) => e.active)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/**
 * Search knowledge by keyword.
 */
export function searchKnowledge(query: string): KnowledgeEntry[] {
  const lower = query.toLowerCase();
  return Array.from(knowledgeStore.values()).filter(
    (e) =>
      e.active &&
      (e.name.toLowerCase().includes(lower) ||
        e.description.toLowerCase().includes(lower) ||
        e.symbol.toLowerCase().includes(lower)),
  );
}

/**
 * Get knowledge statistics.
 */
export function getKnowledgeStats(): {
  total: number;
  active: number;
  validated: number;
  rejected: number;
  byType: Record<KnowledgeType, number>;
  bySymbol: Record<string, number>;
  avgConfidence: number;
  currentVersion: number;
} {
  const entries = Array.from(knowledgeStore.values());
  const active = entries.filter((e) => e.active);
  const validated = entries.filter((e) => e.lastValidatedAt > e.discoveredAt);
  const rejected = entries.filter((e) => !e.active && e.rejectionReason);

  const byType: Record<string, number> = {};
  const bySymbol: Record<string, number> = {};

  for (const e of entries) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    bySymbol[e.symbol] = (bySymbol[e.symbol] ?? 0) + 1;
  }

  return {
    total: entries.length,
    active: active.length,
    validated: validated.length,
    rejected: rejected.length,
    byType: byType as Record<KnowledgeType, number>,
    bySymbol,
    avgConfidence: active.length > 0 ? active.reduce((s, e) => s + e.confidence, 0) / active.length : 0,
    currentVersion,
  };
}

/**
 * Get all knowledge entries (for export/serialization).
 */
export function getAllKnowledge(): KnowledgeEntry[] {
  return Array.from(knowledgeStore.values());
}

// ── Version Management ────────────────────────────────────

function recordVersionChange(
  type: KnowledgeChange["type"],
  entryId: string,
  entryName: string,
  reason: string,
): void {
  // Debounce version increments — batch changes within 1 second
  const lastVersion = versionHistory[versionHistory.length - 1];
  const now = Date.now();

  if (lastVersion && now - lastVersion.createdAt < 1000) {
    lastVersion.changes.push({ type, entryId, entryName, reason });
    return;
  }

  currentVersion++;
  versionHistory.push({
    version: currentVersion,
    hash: computeHash(),
    createdAt: now,
    changes: [{ type, entryId, entryName, reason }],
    performanceDelta: {
      winRateChange: 0,
      sharpeChange: 0,
      entriesAdded: type === "added" ? 1 : 0,
      entriesRemoved: type === "removed" ? 1 : 0,
    },
  });

  // Keep last 100 versions
  if (versionHistory.length > 100) {
    versionHistory.splice(0, versionHistory.length - 100);
  }
}

/**
 * Get the version history.
 */
export function getVersionHistory(): KnowledgeVersion[] {
  return [...versionHistory];
}

/**
 * Get the current knowledge version number.
 */
export function getCurrentKnowledgeVersion(): number {
  return currentVersion;
}

/**
 * Rollback to a previous knowledge version.
 */
export function rollbackToVersion(targetVersion: number): boolean {
  const targetIdx = versionHistory.findIndex((v) => v.version === targetVersion);
  if (targetIdx === -1) return false;

  // Find all changes after the target version and reverse them
  const changesToReverse = versionHistory.slice(targetIdx + 1);

  for (const version of changesToReverse.reverse()) {
    for (const change of version.changes) {
      if (change.type === "added") {
        knowledgeStore.delete(change.entryId);
      } else if (change.type === "removed") {
        // Can't easily restore without snapshots — mark as needing re-validation
        const entry = knowledgeStore.get(change.entryId);
        if (entry) {
          entry.active = true;
          entry.rejectionReason = null;
        }
      }
    }
  }

  currentVersion = targetVersion;
  versionHistory.splice(targetIdx + 1);
  return true;
}

// ── Knowledge Decay ───────────────────────────────────────

/**
 * Apply time-based decay to knowledge confidence.
 * Older, unvalidated knowledge gradually loses confidence.
 */
export function applyKnowledgeDecay(decayRate: number = 0.001): number {
  const now = Date.now();
  let decayed = 0;

  for (const entry of knowledgeStore.values()) {
    if (!entry.active) continue;

    const ageDays = (now - entry.lastValidatedAt) / (24 * 60 * 60 * 1000);
    const decay = decayRate * ageDays;

    if (decay > 0.01) {
      entry.confidence = Math.max(0, entry.confidence - decay);
      entry.version++;

      if (entry.confidence < 0.4) {
        entry.active = false;
        entry.rejectionReason = "Decayed below activation threshold";
        recordVersionChange("removed", entry.id, entry.name, "Knowledge decay");
      }

      decayed++;
    }
  }

  return decayed;
}

// ── Helpers ───────────────────────────────────────────────

function computeHash(): string {
  const entries = Array.from(knowledgeStore.values()).map((e) => `${e.id}:${e.version}`);
  return entries.sort().join("|").substring(0, 64);
}

/**
 * Clear all knowledge (for testing).
 */
export function resetKnowledgeBase(): void {
  knowledgeStore.clear();
  versionHistory.length = 0;
  currentVersion = 1;
  knowledgeCounter = 0;
}
