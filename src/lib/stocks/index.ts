// ============================================================
// STOCK MARKET INTELLIGENCE — Module Exports
// ============================================================

// Data Engine
export {
  fetchStockCandles,
  fetchStockQuote,
  fetchStockQuoteAndCandles,
  fetchStockCorporateActions,
  fetchStockFundamentals,
  fetchBatchQuotes,
  searchStocks,
  extractFundamentals,
  getDiagnostics,
} from "./data-engine";

export type {
  StockQuote,
  StockSearchResult,
  FundamentalData,
  CorporateActions,
  DataDiagnostics,
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
