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
export { useStockStream, toStreamInterval, type StockStreamState } from "./use-stock-stream";
