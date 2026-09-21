// ============================================================
// STOCK MARKET INTELLIGENCE — Module Exports
// ============================================================

// Data Engine
export {
  fetchStockCandles,
  fetchStockQuote,
  fetchBatchQuotes,
  searchStocks,
  extractFundamentals,
} from "./data-engine";

export type {
  StockQuote,
  StockSearchResult,
  FundamentalData,
} from "./data-engine";

// AI Analyst
export { analyzeStock } from "./analyst";

export type {
  StockAnalysis,
  AnalysisSection,
  AnalysisDirection,
  Finding,
  RiskItem,
  KeyLevels,
} from "./analyst";
