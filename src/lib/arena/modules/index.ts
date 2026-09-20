// ============================================================
// AI TRADE ARENA — Analysis Module Registry
//
// Central export for all specialized analysis modules.
// The fusion engine imports these to build its pipeline.
// ============================================================

export type {
  AnalysisModule,
  ModuleInput,
  ModuleOutput,
  ModuleDirection,
  EvidenceItem,
  FusionResult,
  FusionDecision,
  DecisionLogEntry,
} from "./types";

export { technicalModule } from "./technical";
export { regimeModule } from "./regime";
export { momentumModule } from "./momentum";
export { volatilityModule } from "./volatility";
export { volumeModule } from "./volume";
export { orderFlowModule } from "./orderflow";
export { mlPredictorModule } from "./ml-predictor";
export { contextModule } from "./context";

import type { AnalysisModule } from "./types";
import { technicalModule } from "./technical";
import { regimeModule } from "./regime";
import { momentumModule } from "./momentum";
import { volatilityModule } from "./volatility";
import { volumeModule } from "./volume";
import { orderFlowModule } from "./orderflow";
import { mlPredictorModule } from "./ml-predictor";
import { contextModule } from "./context";

/** All registered analysis modules in evaluation order. */
export const ALL_MODULES: AnalysisModule[] = [
  regimeModule,       // Gate: is the regime tradeable?
  technicalModule,    // Core TA indicators
  momentumModule,     // Momentum and trend strength
  volatilityModule,   // Volatility regime
  volumeModule,       // Volume confirmation
  orderFlowModule,    // Order book signals
  mlPredictorModule,  // Quantitative ensemble prediction
  contextModule,      // Broader market context
];
