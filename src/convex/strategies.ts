import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Default strategy parameters matching the spec
const DEFAULT_STRATEGY = {
  name: "BTC Breakout Momentum",
  description: "Trend + Breakout + Momentum + Volatility Expansion",
  symbol: "BTC/USDT",
  timeframe: "15m",
  higherTimeframe: "1h",
  breakoutPeriod: 20,
  atrPeriod: 14,
  atrStopMultiplier: 2,
  atrTargetMultiplier: 4,
  rsiPeriod: 14,
  rsiLowerThreshold: 55,
  rsiUpperThreshold: 75,
  emaShort: 20,
  emaMedium: 50,
  emaLong: 200,
  volumeMultiplier: 1.2,
  riskPerTrade: 0.005,
  maxPositions: 1,
  maxDailyLoss: 0.02,
  maxWeeklyLoss: 0.05,
  maxDrawdown: 0.15,
  maxConsecutiveLosses: 5,
  maxHoldingPeriod: 48,
  slippage: 0.001,
  commission: 0.001,
  spread: 0.0005,
};

// Get all strategies for a user
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const strategies = await ctx.db
      .query("strategies")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return strategies;
  },
});

// Get a specific strategy
export const get = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return null;

    return strategy;
  },
});

// Create a new strategy with default parameters
export const create = mutation({
  args: {
    name: v.optional(v.string()),
    symbol: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();
    const strategy = await ctx.db.insert("strategies", {
      userId,
      ...DEFAULT_STRATEGY,
      name: args.name || DEFAULT_STRATEGY.name,
      symbol: args.symbol || DEFAULT_STRATEGY.symbol,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Also create default user settings if they don't exist
    const existingSettings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!existingSettings) {
      await ctx.db.insert("userSettings", {
        userId,
        theme: "dark",
        defaultSymbol: "BTC/USDT",
        defaultTimeframe: "15m",
        emailNotifications: true,
        signalAlerts: true,
        tradeAlerts: true,
        initialCapital: 10000,
        createdAt: now,
        updatedAt: now,
      });
    }

    return strategy;
  },
});

// Update strategy parameters
export const update = mutation({
  args: {
    strategyId: v.id("strategies"),
    updates: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      breakoutPeriod: v.optional(v.number()),
      atrPeriod: v.optional(v.number()),
      atrStopMultiplier: v.optional(v.number()),
      atrTargetMultiplier: v.optional(v.number()),
      rsiPeriod: v.optional(v.number()),
      rsiLowerThreshold: v.optional(v.number()),
      rsiUpperThreshold: v.optional(v.number()),
      emaShort: v.optional(v.number()),
      emaMedium: v.optional(v.number()),
      emaLong: v.optional(v.number()),
      volumeMultiplier: v.optional(v.number()),
      riskPerTrade: v.optional(v.number()),
      maxPositions: v.optional(v.number()),
      maxDailyLoss: v.optional(v.number()),
      maxWeeklyLoss: v.optional(v.number()),
      maxDrawdown: v.optional(v.number()),
      maxConsecutiveLosses: v.optional(v.number()),
      maxHoldingPeriod: v.optional(v.number()),
      slippage: v.optional(v.number()),
      commission: v.optional(v.number()),
      spread: v.optional(v.number()),
      isActive: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Strategy not found");

    await ctx.db.patch(args.strategyId, {
      ...args.updates,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Delete a strategy
export const remove = mutation({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Strategy not found");

    await ctx.db.delete(args.strategyId);
    return { success: true };
  },
});

// Get strategy summary stats
export const getStats = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return null;

    // Get recent trades
    const trades = await ctx.db
      .query("trades")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .collect();

    // Get recent signals
    const signals = await ctx.db
      .query("signals")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .collect();

    // Get latest backtest
    const backtests = await ctx.db
      .query("backtests")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(1);

    // Calculate basic stats
    const closedTrades = trades.filter((t) => t.status === "closed");
    const winningTrades = closedTrades.filter((t) => (t.netPnL || 0) > 0);
    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.netPnL || 0), 0);

    return {
      totalSignals: signals.length,
      totalTrades: trades.length,
      closedTrades: closedTrades.length,
      winRate: closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
      totalPnL,
      avgWin: winningTrades.length > 0 
        ? winningTrades.reduce((sum, t) => sum + (t.netPnL || 0), 0) / winningTrades.length 
        : 0,
      avgLoss: closedTrades.length - winningTrades.length > 0
        ? closedTrades.filter((t) => (t.netPnL || 0) <= 0).reduce((sum, t) => sum + (t.netPnL || 0), 0) / (closedTrades.length - winningTrades.length)
        : 0,
      latestBacktest: backtests[0] || null,
    };
  },
});
