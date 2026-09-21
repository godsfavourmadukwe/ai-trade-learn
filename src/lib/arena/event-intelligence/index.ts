// ============================================================
// AI TRADE ARENA — Event Intelligence Layer (Feature 5)
//
// Real-time research and event intelligence system.
// Detects, classifies, and scores market events to provide
// context that feeds into the existing analysis pipeline.
// ============================================================

export type {
  MarketEvent,
  EventType,
  EventImpact,
  EventConfirmation,
  EventEvidence,
  AffectedAsset,
  EventIntelligence,
  EventFactor,
  EventCollectorConfig,
} from "./types";

export { EVENT_IMPACT_WEIGHTS, IMPACT_DIRECTION, DEFAULT_EVENT_COLLECTOR_CONFIG } from "./types";

export {
  detectMarketEvents,
  aggregateEvents,
  storeEvent,
  getActiveEvents,
  pruneExpiredEvents,
  checkEventConfirmation,
  updateEventConfig,
  resetEventStore,
  getEventStore,
} from "./collector";

export {
  eventIntelligenceModule,
  getEventIntelligence,
  getCachedEventIntelligence,
} from "./module";
