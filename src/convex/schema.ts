import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

// Trading bot types
export const TRADING_MODE = {
  BACKTEST: "backtest",
  PAPER: "paper",
  LIVE: "live",
} as const;

export const MARKET_REGIME = {
  TRENDING: "trending",
  RANGING: "ranging",
  HIGH_VOLATILITY: "high_volatility",
  LOW_VOLATILITY: "low_volatility",
  DISORDERED: "disordered",
} as const;

export const SIGNAL_TYPE = {
  LONG_ENTRY: "long_entry",
  LONG_EXIT: "long_exit",
  STOP_LOSS: "stop_loss",
  TAKE_PROFIT: "take_profit",
  TRAILING_STOP: "trailing_stop",
  TIME_EXIT: "time_exit",
  INVALIDATION_EXIT: "invalidation_exit",
} as const;

export const TRADE_STATUS = {
  PENDING: "pending",
  OPEN: "open",
  CLOSED: "closed",
  CANCELLED: "cancelled",
  REJECTED: "rejected",
} as const;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Trading Strategy Configurations
    strategies: defineTable({
      userId: v.id("users"),
      name: v.string(),
      description: v.optional(v.string()),
      symbol: v.string(), // e.g., "BTC/USDT"
      timeframe: v.string(), // e.g., "15m"
      higherTimeframe: v.string(), // e.g., "1h"
      
      // Strategy Parameters
      breakoutPeriod: v.number(), // Donchian breakout period (default: 20)
      atrPeriod: v.number(), // ATR period (default: 14)
      atrStopMultiplier: v.number(), // Stop loss ATR multiplier (default: 2)
      atrTargetMultiplier: v.number(), // Take profit ATR multiplier (default: 4)
      rsiPeriod: v.number(), // RSI period (default: 14)
      rsiLowerThreshold: v.number(), // RSI lower threshold (default: 55)
      rsiUpperThreshold: v.number(), // RSI upper threshold (default: 75)
      emaShort: v.number(), // Short EMA (default: 20 for 15m)
      emaMedium: v.number(), // Medium EMA (default: 50 for 1h)
      emaLong: v.number(), // Long EMA (default: 200 for 1h)
      volumeMultiplier: v.number(), // Volume confirmation multiplier (default: 1.2)
      
      // Risk Parameters
      riskPerTrade: v.number(), // Risk per trade as decimal (default: 0.005 = 0.5%)
      maxPositions: v.number(), // Max simultaneous positions (default: 1)
      maxDailyLoss: v.number(), // Max daily loss as decimal (default: 0.02 = 2%)
      maxWeeklyLoss: v.number(), // Max weekly loss as decimal (default: 0.05 = 5%)
      maxDrawdown: v.number(), // Max drawdown as decimal (default: 0.15 = 15%)
      maxConsecutiveLosses: v.number(), // Max consecutive losses (default: 5)
      maxHoldingPeriod: v.number(), // Max holding period in candles (default: 48)
      
      // Execution Settings
      slippage: v.number(), // Slippage in percentage
      commission: v.number(), // Commission in percentage
      spread: v.number(), // Spread in percentage
      
      isActive: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"])
      .index("by_user_active", ["userId", "isActive"]),

    // Market Data Cache (for simulation)
    marketData: defineTable({
      symbol: v.string(),
      timestamp: v.number(),
      open: v.number(),
      high: v.number(),
      low: v.number(),
      close: v.number(),
      volume: v.number(),
      timeframe: v.string(),
    }).index("by_symbol_time", ["symbol", "timeframe", "timestamp"]),

    // Trading Signals
    signals: defineTable({
      strategyId: v.id("strategies"),
      userId: v.id("users"),
      symbol: v.string(),
      timestamp: v.number(),
      signalType: v.string(), // From SIGNAL_TYPE
      price: v.number(),
      
      // Indicator Values at Signal Time
      indicators: v.object({
        ema50: v.number(),
        ema200: v.number(),
        ema20: v.number(),
        rsi: v.number(),
        atr: v.number(),
        breakoutLevel: v.number(),
        volume: v.number(),
        volumeMA: v.number(),
        regime: v.string(),
      }),
      
      // Signal Metadata
      stopLoss: v.optional(v.number()),
      takeProfit: v.optional(v.number()),
      trailingStop: v.optional(v.number()),
      riskReward: v.optional(v.number()),
      positionSize: v.optional(v.number()),
      
      // Execution Details
      executionPrice: v.optional(v.number()),
      slippage: v.optional(v.number()),
      commission: v.optional(v.number()),
      
      reason: v.string(), // Human-readable reason for the signal
      isSimulated: v.boolean(), // Paper trade vs backtest
      
      createdAt: v.number(),
    }).index("by_strategy", ["strategyId", "timestamp"])
      .index("by_user", ["userId", "timestamp"]),

    // Paper Trading / Backtest Trades
    trades: defineTable({
      strategyId: v.id("strategies"),
      userId: v.id("users"),
      signalId: v.id("signals"),
      symbol: v.string(),
      mode: v.string(), // "backtest" | "paper" | "live"
      
      // Trade Details
      entryPrice: v.number(),
      exitPrice: v.optional(v.number()),
      quantity: v.number(),
      direction: v.string(), // "long" | "short"
      
      // Risk Management
      stopLoss: v.number(),
      takeProfit: v.number(),
      trailingStop: v.optional(v.number()),
      
      // Timing
      entryTime: v.number(),
      exitTime: v.optional(v.number()),
      holdingPeriod: v.optional(v.number()), // in candles
      
      // P&L
      grossPnL: v.optional(v.number()),
      netPnL: v.optional(v.number()),
      fees: v.optional(v.number()),
      slippageCost: v.optional(v.number()),
      
      // Status
      status: v.string(), // From TRADE_STATUS
      exitReason: v.optional(v.string()), // "take_profit" | "stop_loss" | "trailing_stop" | "time_exit" | "invalidation"
      
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_strategy", ["strategyId", "entryTime"])
      .index("by_user", ["userId", "entryTime"])
      .index("by_status", ["status"]),

    // Backtest Results
    backtests: defineTable({
      strategyId: v.id("strategies"),
      userId: v.id("users"),
      
      // Test Period
      startDate: v.number(),
      endDate: v.number(),
      dataPoints: v.number(),
      
      // Performance Metrics
      totalReturn: v.number(),
      annualizedReturn: v.number(),
      maxDrawdown: v.number(),
      sharpeRatio: v.number(),
      sortinoRatio: v.number(),
      calmarRatio: v.number(),
      profitFactor: v.number(),
      winRate: v.number(),
      avgWin: v.number(),
      avgLoss: v.number(),
      expectancy: v.number(),
      medianTrade: v.number(),
      totalTrades: v.number(),
      avgHoldingPeriod: v.number(),
      maxLosingStreak: v.number(),
      recoveryTime: v.number(),
      exposure: v.number(),
      turnover: v.number(),
      
      // Cost Analysis
      grossPnL: v.number(),
      netPnL: v.number(),
      totalFees: v.number(),
      totalSlippage: v.number(),
      
      // Configuration
      parameters: v.object({
        breakoutPeriod: v.number(),
        atrStopMultiplier: v.number(),
        rsiLower: v.number(),
        rsiUpper: v.number(),
      }),
      
      // Data Split
      dataSplit: v.string(), // "training" | "validation" | "out_of_sample"
      
      // Status
      status: v.string(), // "running" | "completed" | "failed"
      
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    }).index("by_strategy", ["strategyId", "createdAt"])
      .index("by_user", ["userId", "createdAt"]),

    // AI Learning / Performance Tracking
    learningMetrics: defineTable({
      strategyId: v.id("strategies"),
      userId: v.id("users"),
      
      // Learning Data
      totalDecisions: v.number(),
      correctDecisions: v.number(),
      accuracy: v.number(),
      
      // Regime Performance
      regimePerformance: v.object({
        trending: v.object({ wins: v.number(), losses: v.number(), expectancy: v.number() }),
        ranging: v.object({ wins: v.number(), losses: v.number(), expectancy: v.number() }),
        high_volatility: v.object({ wins: v.number(), losses: v.number(), expectancy: v.number() }),
        low_volatility: v.object({ wins: v.number(), losses: v.number(), expectancy: v.number() }),
      }),
      
      // Learning Insights
      insights: v.array(v.object({
        timestamp: v.number(),
        type: v.string(), // "parameter_adjustment" | "regime_discovery" | "risk_adjustment"
        description: v.string(),
        impact: v.number(), // Impact on performance
      })),
      
      // Confidence Tracking
      confidence: v.number(), // 0-100
      lastUpdated: v.number(),
      
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_strategy", ["strategyId"])
      .index("by_user", ["userId"]),

    // Risk Events / Logs
    riskEvents: defineTable({
      userId: v.id("users"),
      strategyId: v.optional(v.id("strategies")),
      timestamp: v.number(),
      eventType: v.string(), // "daily_loss_limit" | "weekly_loss_limit" | "max_drawdown" | "consecutive_losses" | "emergency_shutdown"
      severity: v.string(), // "warning" | "critical" | "emergency"
      message: v.string(),
      metadata: v.optional(v.object({
        currentLoss: v.number(),
        limit: v.number(),
        positionCount: v.number(),
      })),
      resolved: v.boolean(),
      resolvedAt: v.optional(v.number()),
    }).index("by_user", ["userId", "timestamp"])
      .index("by_strategy", ["strategyId", "timestamp"]),

    // User Settings
    userSettings: defineTable({
      userId: v.id("users"),
      
      // Display Preferences
      theme: v.string(), // "dark" | "light"
      defaultSymbol: v.string(), // e.g., "BTC/USDT"
      defaultTimeframe: v.string(), // e.g., "15m"
      
      // Notification Preferences
      emailNotifications: v.boolean(),
      signalAlerts: v.boolean(),
      tradeAlerts: v.boolean(),
      
      // Risk Settings
      initialCapital: v.number(), // Starting capital in USD
      
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    // ── AI Trade Arena Tables ──────────────────────────

    // Arena Trades — demo trades executed by the AI engine
    arenaTrades: defineTable({
      userId: v.id("users"),
      tradeId: v.string(), // unique engine-assigned trade id
      symbol: v.string(), // e.g. "BTC/USDT"
      exchange: v.string(), // e.g. "binance"
      side: v.string(), // "long" | "short"
      strategy: v.string(), // strategy identifier
      timeframe: v.string(), // primary execution timeframe
      higherTimeframe: v.optional(v.string()),
      entryPrice: v.number(),
      stopLoss: v.number(),
      takeProfit: v.number(),
      trailingStop: v.optional(v.number()),
      riskReward: v.number(),
      positionSize: v.number(),
      risk: v.number(),
      modelProbability: v.number(),
      expectedReturn: v.number(),
      expectedValue: v.number(),
      marketRegime: v.string(),
      modelVersion: v.string(),
      signalTime: v.number(),
      openTime: v.optional(v.number()),
      status: v.string(), // "pending" | "open" | "stopped" | "takeprofit" | "closed" | "cancelled" | "rejected"
      exitPrice: v.optional(v.number()),
      exitTime: v.optional(v.number()),
      exitReason: v.optional(v.string()),
      realizedPnl: v.optional(v.number()),
      fees: v.optional(v.number()),
      slippage: v.optional(v.number()),
      reasonCodes: v.array(v.string()),
      summary: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_user_status", ["userId", "status"])
      .index("by_tradeId", ["tradeId"]),

    // Arena Signals — signals generated by the AI engine
    arenaSignals: defineTable({
      userId: v.id("users"),
      signalId: v.string(), // unique engine-assigned signal id
      symbol: v.string(),
      exchange: v.string(),
      side: v.string(), // "long" | "short"
      strategy: v.string(),
      timeframe: v.string(),
      entry: v.number(),
      stopLoss: v.number(),
      takeProfit: v.number(),
      riskReward: v.number(),
      modelProbability: v.number(),
      expectedValue: v.number(),
      marketRegime: v.string(),
      modelVersion: v.string(),
      reasonCodes: v.array(v.string()),
      summary: v.string(),
      status: v.string(), // "pending" | "accepted" | "invalidated" | "rejected"
      createdAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_signalId", ["signalId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
