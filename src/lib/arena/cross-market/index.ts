// ============================================================
// AI TRADE ARENA — Cross-Market Intelligence Orchestrator
//
// Single entry point for the arena engine:
//   • precomputeCrossMarketContext() — async, refreshes the
//     universe and computes/refreshes cached contexts per side.
//   • getCachedCrossMarketContext() — sync, for the fusion pipeline.
//
// All data comes from the existing market-data providers via the
// registry. No invented data, no hardcoded assets: related
// markets are discovered dynamically by correlation + liquidity.
// ============================================================

import {
  computeCrossMarketContext,
  DEFAULT_CROSS_MARKET_CONFIG,
  type CrossMarketEngineConfig,
} from "./engine";
import { crossMarketUniverseService } from "./universe";
import type { CrossMarketContext, CrossMarketInput } from "./types";

export type {
  CrossMarketContext,
  CrossMarketVerdict,
  CrossMarketFactor,
  RelatedMarket,
  MarketBreadth,
  MarketVolatilityState,
  FactorLean,
  CorrelationStrength,
  CrossMarketInput,
} from "./types";

// ── Cached state ───────────────────────────────────────────

interface CacheEntry {
  context: CrossMarketContext;
  expiresAt: number;
}

const contextCache = new Map<string, CacheEntry>();
const CONTEXT_TTL_MS = 3 * 60 * 1000; // recompute at most every 3 min per pair+side
const CANDLES_PER_REFRESH = 6; // rate-limit friendly batch size

function cacheKey(exchangeSymbol: string, side: "long" | "short"): string {
  return `${exchangeSymbol}:${side}`;
}

/** Registry-pair subset needed by the orchestrator. */
export interface UniversePairInfo {
  exchangeSymbol: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  /** Known 24h quote volume (0 = unknown; ranking improves as data arrives). */
  quoteVolume24h?: number;
}

/**
 * Persistent volume knowledge gathered from provider tickers across
 * refreshes. Lets candidate ranking converge on liquid markets without
 * ever pulling the full-market ticker index.
 */
const knownVolumes = new Map<string, number>();

function recordKnownVolumes(symbols: string[]): void {
  for (const s of symbols) {
    const t = crossMarketUniverseService.getCachedTicker(s);
    if (t && t.quoteVolume24h > 0) knownVolumes.set(s, t.quoteVolume24h);
  }
}

// ── Candidate selection (dynamic, no hardcoding) ───────────

/**
 * Select candidate universe members for a target pair, dynamically.
 * Same-quote liquid pairs (ranked by 24h volume) plus same-base
 * pairs (e.g. ETH/BTC for ETH/USDT). Derived from provider data only.
 */
export function selectUniverseCandidates(
  targetExchangeSymbol: string,
  registryPairs: UniversePairInfo[],
  maxCandidates: number,
): string[] {
  const target = registryPairs.find((p) => p.exchangeSymbol === targetExchangeSymbol);
  if (!target) return [];

  const { baseAsset, quoteAsset } = target;

  // Same-base pairs are the most closely related — always include.
  const sameBase = registryPairs
    .filter((p) => p.exchangeSymbol !== targetExchangeSymbol && p.baseAsset === baseAsset)
    .map((p) => p.exchangeSymbol);

  // Same-quote pairs ranked by known liquidity (improves as ticker data
  // arrives across refresh cycles — no full-market index needed).
  const sameQuote = registryPairs
    .filter((p) => p.exchangeSymbol !== targetExchangeSymbol && p.quoteAsset === quoteAsset)
    .sort(
      (a, b) =>
        (knownVolumes.get(b.exchangeSymbol) ?? b.quoteVolume24h ?? 0) -
        (knownVolumes.get(a.exchangeSymbol) ?? a.quoteVolume24h ?? 0),
    )
    .map((p) => p.exchangeSymbol);

  const combined = [...sameBase, ...sameQuote];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of combined) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= maxCandidates) break;
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Asynchronously refresh the cross-market universe and compute the
 * context for a target pair+side. Safe to call frequently —
 * TTL-gated and deduplicated in-flight; failures preserve cached
 * data and never throw.
 */
export async function precomputeCrossMarketContext(
  targetExchangeSymbol: string,
  targetSymbol: string,
  side: "long" | "short",
  registryPairs: UniversePairInfo[],
  targetVolatility: number,
  now: number,
  config: Partial<CrossMarketEngineConfig> = {},
): Promise<CrossMarketContext | null> {
  const key = cacheKey(targetExchangeSymbol, side);
  const cached = contextCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.context;

  try {
    // 1. Select the candidate universe dynamically
    const universe = selectUniverseCandidates(
      targetExchangeSymbol,
      registryPairs,
      DEFAULT_UNIVERSE_CANDIDATES,
    );
    if (universe.length < MIN_UNIVERSE_CANDIDATES) return null;

    // 2. Refresh tickers for [self, ...universe]
    const allSymbols = [targetExchangeSymbol, ...universe];
    await crossMarketUniverseService.refreshTickers(allSymbols);
    if (!crossMarketUniverseService.hasFreshTickers()) return null;

    // Learn volumes for better candidate ranking on later cycles
    recordKnownVolumes(allSymbols);

    // 3. Refresh candles for a bounded batch of universe members
    //    (rate-limit friendly; caches make later cycles cheap).
    const needCandles = allSymbols.filter(
      (s) => !crossMarketUniverseService.hasFreshCandles(s),
    );
    for (const s of needCandles.slice(0, CANDLES_PER_REFRESH)) {
      await crossMarketUniverseService.refreshCandles(s);
    }

    // 4. Build the snapshot from cache
    const candidates = registryPairs
      .filter((p) => allSymbols.includes(p.exchangeSymbol))
      .map((p) => ({ exchangeSymbol: p.exchangeSymbol, symbol: p.symbol }));
    const snapshot = crossMarketUniverseService.buildSnapshot(targetExchangeSymbol, candidates);
    if (snapshot.members.length < 3) return null;

    // 5. Compute the context (pure function)
    const input: CrossMarketInput = {
      exchangeSymbol: targetExchangeSymbol,
      symbol: targetSymbol,
      side,
      universe: snapshot.members,
      returnSeries: snapshot.returnSeries,
      targetVolatility: snapshot.volatility.get(targetExchangeSymbol) ?? targetVolatility,
      now,
    };
    const context = computeCrossMarketContext(input, {
      ...DEFAULT_CROSS_MARKET_CONFIG,
      ...config,
    });

    // 6. Cache and return
    contextCache.set(key, { context, expiresAt: Date.now() + CONTEXT_TTL_MS });
    return context;
  } catch {
    // Never throw — the fusion pipeline must not break
    return null;
  }
}

/**
 * Synchronous read of the cached cross-market context for a pair+side.
 * Returns null when no fresh context exists — callers must treat
 * missing context as neutral (never force a trade).
 */
export function getCachedCrossMarketContext(
  exchangeSymbol: string,
  side: "long" | "short",
): CrossMarketContext | null {
  const entry = contextCache.get(cacheKey(exchangeSymbol, side));
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) return null;
  return entry.context;
}

/** Drop expired cache entries (housekeeping). */
export function pruneCrossMarketCache(now: number = Date.now()): void {
  for (const [key, entry] of contextCache) {
    if (now >= entry.expiresAt) contextCache.delete(key);
  }
}

/** Clear all cached contexts (used by tests). */
export function resetCrossMarketCache(): void {
  contextCache.clear();
  crossMarketUniverseService.reset();
}

// ── Tuning constants ───────────────────────────────────────

/** Candidates considered per target pair (top by liquidity). */
const DEFAULT_UNIVERSE_CANDIDATES = 20;
/** Minimum candidates required before computing context. */
const MIN_UNIVERSE_CANDIDATES = 5;
