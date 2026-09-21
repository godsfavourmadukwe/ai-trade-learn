export * from "./types";
export * from "./conditions";
export { arenaEngine, ArenaEngine } from "./engine";
export type { ArenaEngineConfig, ArenaSnapshot, ArenaStatusInfo } from "./engine";

// Multi-layer decision engine
export { DecisionFusionEngine, decisionFusionEngine } from "./fusion";
export type { FusionConfig } from "./fusion";
export { DecisionLogger, decisionLogger } from "./decision-logger";
export {
  ALL_MODULES,
  technicalModule,
  regimeModule,
  momentumModule,
  volatilityModule,
  volumeModule,
  orderFlowModule,
  mlPredictorModule,
  contextModule,
} from "./modules";
export type {
  AnalysisModule,
  ModuleInput,
  ModuleOutput,
  ModuleDirection,
  EvidenceItem,
  FusionResult,
  FusionDecision,
  DecisionLogEntry,
} from "./modules";

// Market Regime Intelligence
export {
  RegimeIntelligenceEngine,
  regimeIntelEngine,
} from "./regime-intel";
export type {
  ExtendedRegime,
  RegimeConfidence,
  RegimeFeatures,
  RegimeIntelligence,
  RegimeTransition,
  StrategyAdjustments,
  RegimeIntelConfig,
  RegimeHistoryEntry,
} from "./regime-intel/types";
export { EXTENDED_TO_BASE_REGIME } from "./regime-intel/types";
export { extractRegimeFeatures } from "./regime-intel/features";
export { classifyRegime, classifyRegimeMTF } from "./regime-intel/classifier";
export { RegimeTransitionDetector } from "./regime-intel/transitions";
export { computeStrategyAdjustments, getRegimeSuitabilityScore } from "./regime-intel/strategy-filter";

// Cross-Market Intelligence
export {
  precomputeCrossMarketContext,
  getCachedCrossMarketContext,
  pruneCrossMarketCache,
  resetCrossMarketCache,
  selectUniverseCandidates,
} from "./cross-market";
export { CrossMarketUniverseService, crossMarketUniverseService } from "./cross-market/universe";
export { computeCrossMarketContext, pearsonCorrelation } from "./cross-market/engine";
export type {
  CrossMarketContext,
  CrossMarketVerdict,
  CrossMarketFactor,
  CrossMarketInput,
  RelatedMarket,
  MarketBreadth,
  MarketVolatilityState,
  FactorLean,
  CorrelationStrength,
} from "./cross-market/types";
export type {
  CrossMarketEngineConfig,
} from "./cross-market/engine";
export type {
  UniverseConfig,
  CrossMarketSnapshot,
} from "./cross-market/universe";
export type { UniversePairInfo } from "./cross-market";

// Event Intelligence (Feature 5)
export * from "./event-intelligence";
