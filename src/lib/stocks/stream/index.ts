// ============================================================
// STOCK STREAM — Module exports
// ============================================================

export { parseStreamerMessage, decodePricingData, type StreamTick } from "./protobuf";
export {
  CandleAggregator,
  bucketStart,
  STREAM_INTERVALS,
  STREAM_INTERVAL_MS,
  type StreamInterval,
} from "./candles";
export {
  getMarketStatus,
  isUsExchange,
  type MarketStatus,
  type MarketSession,
} from "./market-hours";
export {
  StockStreamEngine,
  stockStreamEngine,
  type StreamStatus,
  type StreamHealth,
  type StreamCallbacks,
} from "./engine";
export { base64ToBytes } from "./protobuf";
export {
  useStockStream,
  toStreamInterval,
  combineStreamHealth,
  type StockStreamState,
  type StockStreamRow,
} from "./use-stock-stream";
export { applyLiveQuote, type LiveQuotePatch } from "./quote-merge";
