// ============================================================
// AI TRADE ARENA — Multi-Layer Analysis Module Types
//
// Each analysis module is an independent "expert" that examines
// market data from its own perspective and produces structured
// output. The Decision Fusion Engine combines these outputs.
//
// Default decision is always NO_TRADE.
// ============================================================

import type { Candle } from "@/lib/market/types";
import type { MarketRegime, ArenaTimeframe, TradeSide } from "../types";

// ── Module Input ────────────────────────────────────────────

/** Shared input passed to every analysis module. */
export interface ModuleInput {
  symbol: string;            // display symbol e.g. "BTC/USDT"
  exchangeSymbol: string;    // exchange-native e.g. "BTCUSDT"
  side: TradeSide;
  candles15m: Candle[];
  candles1h: Candle[];
  candles4h: Candle[];
  livePrice: number;
  ticker: {
    price: number;
    change24hPercent: number;
    high24h: number;
    low24h: number;
    volume24hBase: number;
    quoteVolume24h: number;
    open24h: number;
  } | null;
  orderBook: {
    bid: number;
    ask: number;
    bidQty: number;
    askQty: number;
    spreadBps: number;
  } | null;
  priceHistory: number[];    // recent price ticks
  volumeHistory: number[];   // recent volume ticks
  now: number;               // current timestamp ms
}

// ── Module Output ───────────────────────────────────────────

export type ModuleDirection = "bullish" | "bearish" | "neutral";

/** A single piece of evidence from a module. */
export interface EvidenceItem {
  type: "supporting" | "contradicting" | "neutral";
  label: string;
  value: string;
  detail: string;
  source?: string;  // module name or computation source
  weight?: number;  // relative importance 0-1, defaults to 1
}

/** Structured output from each analysis module. */
export interface ModuleOutput {
  /** Unique module name (e.g. "technical", "momentum"). */
  module: string;
  /** Human-readable module description. */
  description: string;
  /** Overall directional lean. */
  direction: ModuleDirection;
  /** Strength of the signal 0-1 (how strong the directional lean is). */
  strength: number;
  /** Module's own confidence in its analysis 0-1. */
  confidence: number;
  /** Uncertainty / noise estimate 0-1 (higher = less reliable). */
  uncertainty: number;
  /** Supporting and contradicting evidence items. */
  evidence: EvidenceItem[];
  /** If true, this module vetoes ALL trades regardless of other modules. */
  veto: boolean;
  /** Optional human-readable veto reason. */
  vetoReason?: string;
  /** Numerical metrics specific to this module. */
  metrics: Record<string, number>;
  /** Timestamp of the analysis. */
  analyzedAt: number;
}

// ── Fusion Result ───────────────────────────────────────────

export type FusionDecision = "BUY" | "SELL" | "NO_TRADE";

/** The combined output from the Decision Fusion Engine. */
export interface FusionResult {
  decision: FusionDecision;
  confidence: number;
  uncertainty: number;
  /** All module outputs that contributed to the decision. */
  modules: ModuleOutput[];
  /** Number of modules that agree with the decision direction. */
  supportingCount: number;
  /** Number of modules that disagree. */
  contradictingCount: number;
  /** Number of neutral modules. */
  neutralCount: number;
  /** Modules that triggered a veto. */
  vetoModules: string[];
  /** Aggregated evidence for the final decision. */
  evidence: EvidenceItem[];
  /** Machine-readable reason codes. */
  reasonCodes: string[];
  /** Human-readable summary of the decision. */
  summary: string;
  /** Timestamp. */
  generatedAt: number;
  /** Estimated probability TP is reached before SL (from ensemble). */
  modelProbability: number;
  /** Expected return after all costs. */
  expectedValue: number;
  /** Estimated uncertainty of the model probability. */
  modelUncertainty: number;
}

// ── Decision Log Entry ──────────────────────────────────────

/** Full audit trail for every decision the engine makes. */
export interface DecisionLogEntry {
  logId: string;
  symbol: string;
  side: TradeSide;
  decision: FusionDecision;
  confidence: number;
  uncertainty: number;
  vetoModules: string[];
  supportingModules: string[];
  contradictingModules: string[];
  neutralModules: string[];
  reasonCodes: string[];
  summary: string;
  moduleOutputs: ModuleOutput[];
  /** Snapshotted market data at decision time. */
  marketSnapshot: {
    price: number;
    change24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    regime: MarketRegime;
  };
  timestamp: number;
  /** If a trade was opened, link it. */
  tradeId: string | null;
}

// ── Analysis Module Interface ───────────────────────────────

/** Every analysis module must implement this interface. */
export interface AnalysisModule {
  /** Unique module name. */
  readonly name: string;
  /** Human-readable description. */
  readonly description: string;
  /** Module weight in the fusion engine (0-1). */
  readonly weight: number;
  /** Run analysis on the given market data. */
  analyze(input: ModuleInput): ModuleOutput;
}
