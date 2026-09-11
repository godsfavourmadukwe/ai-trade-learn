// ============================================================
// AI TRADE ARENA — shared core types
// Backend-first: these shapes are the contract between the
// market/data layer, the signal/risk/execution engines, Convex
// storage, and the arena UI.
// ============================================================

/** All trading directions the arena supports. */
export type TradeSide = "long" | "short";

/** High-level status of an arena trade. */
export type ArenaTradeStatus =
  | "pending"
  | "open"
  | "stopped"
  | "takeprofit"
  | "closed"
  | "cancelled"
  | "rejected";

/** Why a trade was opened or closed. Stored, never inferred by the UI. */
export type TradeExitReason =
  | "take_profit"
  | "stop_loss"
  | "trailing_stop"
  | "time_exit"
  | "invalidation_exit"
  | "manual_close"
  | "signal_invalidated";

/** Normalized market regime label used by the arena. */
export type MarketRegime =
  | "strong_uptrend"
  | "uptrend"
  | "ranging"
  | "downtrend"
  | "strong_downtrend"
  | "high_volatility"
  | "low_volatility"
  | "unknown";

/** Execution mode for demo trades. */
export type DemoMode = "demo";

/** Supported execution timeframes for arena signals. */
export type ArenaTimeframe =
  | "1m"
  | "5m"
  | "15m"
  | "1h"
  | "4h"
  | "1d";

/** Core instrument metadata. Built dynamically from the connected provider,
 *  not hardcoded. */
export interface ArenaInstrument {
  /** Normalized arena symbol, e.g. "BTC/USDT". */
  symbol: string;
  /** Exchange-native symbol, e.g. "BTCUSDT". */
  exchangeSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string;
  exchange: string;
  /** Minimum tradable quantity in base asset units. */
  minQuantity: number;
  /** Price tick size/precision. */
  pricePrecision: number;
  /** Quantity step size/precision. */
  quantityPrecision: number;
  /** Estimated minimum notional order value in quote currency. */
  minNotional: number;
  /** Whether the instrument is currently tailable/tradable in the arena. */
  tradable: boolean;
  /** Last known 24h quote volume (0 if unknown). */
  volume24hQuote: number;
  /** Status source from the provider. */
  status: "online" | "offline" | "unknown";
  /** Timeframe support derived from provider capabilities. */
  supportedTimeframes: ArenaTimeframe[];
}

/** A validated arena signal ready for the risk engine. */
export interface ArenaSignal {
  signalId: string;
  symbol: string;
  exchange: string;
  side: TradeSide;
  strategy: string;
  timeframe: ArenaTimeframe;
  higherTimeframe: ArenaTimeframe | null;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  positionSize: number;
  risk: number;
  /** Model-estimated probability TP is hit before SL. */
  modelProbability: number;
  /** Model-estimated expected return on the position. */
  expectedReturn: number;
  /** Expected value after fees/slippage. */
  expectedValue: number;
  /** Estimated adverse/favorable excursion used for risk decisions. */
  expectedAdverseExcursion: number;
  expectedFavorableExcursion: number;
  marketRegime: MarketRegime;
  modelVersion: string;
  featuresVersion: string;
  signalTime: number;
  /** Quantitative evidence behind the decision. */
  evidence: ArenaSignalEvidence;
  /** Short machine-readable reason codes. */
  reasonCodes: string[];
  /** Human summary generated from stored system data. */
  summary: string;
  status: "pending" | "accepted" | "invalidated";
  /** Highest model uncertainty tolerated for this signal. */
  uncertainty: number;
  /** Data health snapshot at signal time. */
    dataHealthAtSignal: ArenaDataHealth;
}

/** Quantitative evidence attached to a signal. */
export interface ArenaSignalEvidence {
  trend: ArenaEvidenceItem;
  momentum: ArenaEvidenceItem;
  volatility: ArenaEvidenceItem;
  volume: ArenaEvidenceItem;
  liquidity: ArenaEvidenceItem;
  regime: ArenaEvidenceItem;
  model: ArenaEvidenceItem;
  expectedValue: ArenaEvidenceItem;
  riskReward: ArenaEvidenceItem;
  uncertainty: ArenaEvidenceItem;
}

export interface ArenaEvidenceItem {
  label: string;
  value: string;
  detail: string;
  source: string;
}

/** Data health snapshot used for stale/disconnect gating. */
export interface ArenaDataHealth {
  feedHealth: "connected" | "reconnecting" | "stale" | "error" | "unknown";
  lastTickMsAgo: number;
  lastCandleAgeMsAgo: number;
  hasGaps: boolean;
  provider: string;
}

/** The demo trade record the arena displays and copies from. */
export interface ArenaTrade {
  tradeId: string;
  symbol: string;
  exchange: string;
  side: TradeSide;
  strategy: string;
  timeframe: ArenaTimeframe;
  higherTimeframe: ArenaTimeframe | null;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop: number | null;
  riskReward: number;
  positionSize: number;
  risk: number;
  modelProbability: number;
  expectedReturn: number;
  expectedValue: number;
  marketRegime: MarketRegime;
  modelVersion: string;
  featuresVersion: string;
  signalTime: number;
  openTime: number | null;
  status: ArenaTradeStatus;
  exitPrice: number | null;
  exitTime: number | null;
  exitReason: TradeExitReason | null;
  realizedPnl: number | null;
  fees: number | null;
  slippage: number | null;
  // attached signal id for auditability
  signalId: string | null;
  reasonCodes: string[];
  createdAt: number;
  updatedAt: number;
}

/** Real-time events streamed to the arena UI. */
export type ArenaEvent =
  | { type: "signal_created"; signal: ArenaSignal }
  | { type: "signal_accepted"; signalId: string }
  | { type: "signal_invalidated"; signalId: string; reason: string }
  | { type: "trade_opened"; trade: ArenaTrade }
  | { type: "trade_updated"; trade: ArenaTrade }
  | { type: "stop_updated"; tradeId: string; stopLoss: number }
  | { type: "tp_reached"; tradeId: string; exitPrice: number }
  | { type: "trade_closed"; trade: ArenaTrade }
  | { type: "trade_cancelled"; tradeId: string; reason: string }
  | { type: "signal_rejected"; signalId: string; reason: string }
  | { type: "model_paused"; reason: string }
  | { type: "model_resumed"; modelVersion: string }
  | { type: "data_stale"; health: ArenaDataHealth }
  | { type: "data_recovered"; health: ArenaDataHealth }
  | { type: "copy_request_created"; copyRequest: ArenaCopyRequest }
  | { type: "copy_request_updated"; copyRequest: ArenaCopyRequest }
  | { type: "copy_request_rejected"; copyRequestId: string; reason: string }
  | { type: "copy_position_opened"; copyTrade: ArenaCopyTrade }
  | { type: "copy_position_updated"; copyTrade: ArenaCopyTrade }
  | { type: "copy_position_closed"; copyTrade: ArenaCopyTrade }
  | { type: "kill_switch_engaged"; by: string }
  | { type: "kill_switch_disengaged"; by: string };

/** Copy trade request submitted by a user. */
export interface ArenaCopyRequest {
  copyRequestId: string;
  userId: string;
  originalTradeId: string;
  desiredSide: TradeSide;
  desiredEntry: number;
  desiredStopLoss: number;
  desiredTakeProfit: number;
  desiredRiskReward: number;
  requestedPositionSize: number;
  requestedRisk: number;
  mode: CopyMode;
  status: CopyRequestStatus;
  maxEstimatedLoss: number;
  createdAt: number;
  updatedAt: number;
}

export type CopyMode = "manual" | "assisted" | "automated";
export type CopyRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "queued"
  | "open"
  | "closed"
  | "cancelled";

/** A copy trade position created from an approved copy request. */
export interface ArenaCopyTrade {
  copyTradeId: string;
  copyRequestId: string;
  userId: string;
  originalTradeId: string;
  symbol: string;
  exchange: string;
  side: TradeSide;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop: number | null;
  riskReward: number;
  positionSize: number;
  risk: number;
  maxEstimatedLoss: number;
  openTime: number | null;
  status: ArenaTradeStatus;
  exitPrice: number | null;
  exitTime: number | null;
  exitReason: TradeExitReason | null;
  realizedPnl: number | null;
  fees: number | null;
  slippage: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Copy trading safety configuration enforced server-side. */
export interface CopySafetyConfig {
  maxRiskPerTrade: number;
  maxDailyLoss: number;
  maxOpenTrades: number;
  maxExposure: number;
  allowedSymbols: string[];
  emergencyStop: boolean;
  globalKillSwitch: boolean;
  automatedAllowed: boolean;
  automatedOnlyIfUserId: string | null;
}

/** Arena performance summary. */
export interface ArenaPerformanceSummary {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  averageWin: number;
  averageLoss: number;
  averageHoldingSeconds: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  modelVersion: string;
  featuresVersion: string;
  firstTradeTime: number | null;
  lastTradeTime: number | null;
}

/** Arena system status exposed to the UI. */
export interface ArenaStatus {
  enabled: boolean;
  modelVersion: string;
  featuresVersion: string;
  paused: boolean;
  pausedReason: string | null;
  dataHealth: ArenaDataHealth;
  copySafety: CopySafetyConfig | null;
  lastDecisionTime: number | null;
  decisionsToday: number;
  decisionsRejectedToday: number;
}
