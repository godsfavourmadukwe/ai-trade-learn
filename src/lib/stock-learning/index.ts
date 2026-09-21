// ============================================================
// AUTONOMOUS STOCK MARKET LEARNING — Main Exports
//
// Complete autonomous stock-market research, simulation and
// learning system. Knowledge flows forward only.
// ============================================================

// Types
export type {
  StockInfo,
  UniverseSnapshot,
  AssetClass,
  Market,
  TrainingEpisode,
  BlindDecision,
  EpisodeResult,
  EpisodeTrade,
  EpisodeCheckpoint,
  EpisodeStatus,
  KnowledgeEntry,
  KnowledgeType,
  KnowledgePattern,
  KnowledgePerformance,
  KnowledgeVersion,
  KnowledgeChange,
  TrainingJob,
  PipelineStage,
  PipelineJobStatus,
  JobCheckpoint,
  JobSummary,
  StockLearningConfig,
  CommandCenterSnapshot,
  AIQuery,
  AIResponse,
  AIDataPoint,
  PatternCondition,
} from "./types";

export { DEFAULT_STOCK_LEARNING_CONFIG } from "./types";

// Stock Universe
export {
  initializeUniverse,
  getUniverseSnapshot,
  queryUniverse,
  addToUniverse,
  getStockInfo,
  getTrainingSymbols,
  getSectors,
  getAssetsBySector,
  getUniverseStats,
} from "./universe";

// Blind Training Agent
export { BlindTrainingAgent, runBlindEpisode } from "./agent";

// Knowledge Base
export {
  addKnowledge,
  updateKnowledge,
  validateKnowledge,
  deactivateKnowledge,
  getKnowledgeForSymbol,
  getKnowledgeForRegime,
  getKnowledgeByType,
  getTopKnowledge,
  searchKnowledge,
  getKnowledgeStats,
  getAllKnowledge,
  getVersionHistory,
  getCurrentKnowledgeVersion,
  rollbackToVersion,
  applyKnowledgeDecay,
  resetKnowledgeBase,
} from "./knowledge-base";

// Continuous Learning Pipeline
export {
  createTrainingJob,
  getActiveJobs,
  getCompletedJobs,
  getJob,
  runTrainingJob,
  getPipelineStatus,
} from "./pipeline";

// AI Command Center
export {
  getCommandCenterSnapshot,
  getJobProgress,
  getKnowledgeGrowthTimeline,
  getStrategyRankings,
} from "./command-center";

// Conversational AI
export { generateAIResponse } from "./conversational-ai";
