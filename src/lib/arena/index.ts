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
