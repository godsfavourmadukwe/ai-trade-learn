import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Get backtests for a strategy
export const listByStrategy = query({
  args: { strategyId: v.id("strategies"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return [];

    const backtests = await ctx.db
      .query("backtests")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(args.limit || 20);

    return backtests;
  },
});

// Get latest backtest result
export const getLatest = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return null;

    const backtests = await ctx.db
      .query("backtests")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(1);

    return backtests[0] || null;
  },
});

// Record a backtest result
export const recordBacktest = mutation({
  args: {
    strategyId: v.id("strategies"),
    startDate: v.number(),
    endDate: v.number(),
    dataPoints: v.number(),
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
    grossPnL: v.number(),
    netPnL: v.number(),
    totalFees: v.number(),
    totalSlippage: v.number(),
    parameters: v.object({
      breakoutPeriod: v.number(),
      atrStopMultiplier: v.number(),
      rsiLower: v.number(),
      rsiUpper: v.number(),
    }),
    dataSplit: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Strategy not found");

    const now = Date.now();
    const backtest = await ctx.db.insert("backtests", {
      strategyId: args.strategyId,
      userId,
      startDate: args.startDate,
      endDate: args.endDate,
      dataPoints: args.dataPoints,
      totalReturn: args.totalReturn,
      annualizedReturn: args.annualizedReturn,
      maxDrawdown: args.maxDrawdown,
      sharpeRatio: args.sharpeRatio,
      sortinoRatio: args.sortinoRatio,
      calmarRatio: args.calmarRatio,
      profitFactor: args.profitFactor,
      winRate: args.winRate,
      avgWin: args.avgWin,
      avgLoss: args.avgLoss,
      expectancy: args.expectancy,
      medianTrade: args.medianTrade,
      totalTrades: args.totalTrades,
      avgHoldingPeriod: args.avgHoldingPeriod,
      maxLosingStreak: args.maxLosingStreak,
      recoveryTime: args.recoveryTime,
      exposure: args.exposure,
      turnover: args.turnover,
      grossPnL: args.grossPnL,
      netPnL: args.netPnL,
      totalFees: args.totalFees,
      totalSlippage: args.totalSlippage,
      parameters: args.parameters,
      dataSplit: args.dataSplit,
      status: "completed",
      createdAt: now,
      completedAt: now,
    });

    return backtest;
  },
});

// Get performance comparison across splits
export const getPerformanceComparison = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return null;

    const backtests = await ctx.db
      .query("backtests")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .collect();

    const bySplit = {
      training: backtests.filter((b) => b.dataSplit === "training"),
      validation: backtests.filter((b) => b.dataSplit === "validation"),
      out_of_sample: backtests.filter((b) => b.dataSplit === "out_of_sample"),
    };

    const getStats = (tests: typeof backtests) => {
      if (tests.length === 0) return null;
      const latest = tests[0];
      return {
        totalReturn: latest.totalReturn,
        sharpeRatio: latest.sharpeRatio,
        maxDrawdown: latest.maxDrawdown,
        winRate: latest.winRate,
        expectancy: latest.expectancy,
        totalTrades: latest.totalTrades,
      };
    };

    return {
      training: getStats(bySplit.training),
      validation: getStats(bySplit.validation),
      outOfSample: getStats(bySplit.out_of_sample),
    };
  },
});
