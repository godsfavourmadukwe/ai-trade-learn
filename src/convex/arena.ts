import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ── Arena Trades ─────────────────────────────────────────

// Get all arena trades for the current user
export const listTrades = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const trades = await ctx.db
      .query("arenaTrades")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit || 100);

    return trades;
  },
});

// Get open arena trades
export const getOpenTrades = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const trades = await ctx.db
      .query("arenaTrades")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "open"),
      )
      .collect();

    return trades;
  },
});

// Get arena performance summary
export const getPerformance = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const trades = await ctx.db
      .query("arenaTrades")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const closed = trades.filter((t) => t.status === "closed");
    const winning = closed.filter((t) => (t.realizedPnl ?? 0) > 0);
    const losing = closed.filter((t) => (t.realizedPnl ?? 0) <= 0);
    const totalPnl = closed.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);

    const avgWin =
      winning.length > 0
        ? winning.reduce((s, t) => s + (t.realizedPnl ?? 0), 0) / winning.length
        : 0;
    const avgLoss =
      losing.length > 0
        ? losing.reduce((s, t) => s + (t.realizedPnl ?? 0), 0) / losing.length
        : 0;

    let peak = 10000;
    let maxDd = 0;
    let equity = 10000;
    for (const t of closed) {
      equity += t.realizedPnl ?? 0;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDd) maxDd = dd;
    }

    return {
      totalTrades: closed.length,
      openTrades: trades.filter((t) => t.status === "open").length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      totalPnl,
      winRate: closed.length > 0 ? winning.length / closed.length : 0,
      profitFactor:
        avgLoss !== 0
          ? Math.abs((avgWin * winning.length) / (avgLoss * losing.length))
          : 0,
      expectancy: closed.length > 0 ? totalPnl / closed.length : 0,
      averageWin: avgWin,
      averageLoss: avgLoss,
      maxDrawdown: maxDd,
      capital: 10000 + totalPnl,
    };
  },
});

// Record an arena trade (called by the engine after execution)
export const recordTrade = mutation({
  args: {
    tradeId: v.string(),
    symbol: v.string(),
    exchange: v.string(),
    side: v.string(),
    strategy: v.string(),
    timeframe: v.string(),
    higherTimeframe: v.optional(v.string()),
    entryPrice: v.number(),
    stopLoss: v.number(),
    takeProfit: v.number(),
    riskReward: v.number(),
    positionSize: v.number(),
    risk: v.number(),
    modelProbability: v.number(),
    expectedReturn: v.number(),
    expectedValue: v.number(),
    marketRegime: v.string(),
    modelVersion: v.string(),
    signalTime: v.number(),
    reasonCodes: v.array(v.string()),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();
    const trade = await ctx.db.insert("arenaTrades", {
      userId,
      tradeId: args.tradeId,
      symbol: args.symbol,
      exchange: args.exchange,
      side: args.side,
      strategy: args.strategy,
      timeframe: args.timeframe,
      higherTimeframe: args.higherTimeframe,
      entryPrice: args.entryPrice,
      stopLoss: args.stopLoss,
      takeProfit: args.takeProfit,
      trailingStop: undefined,
      riskReward: args.riskReward,
      positionSize: args.positionSize,
      risk: args.risk,
      modelProbability: args.modelProbability,
      expectedReturn: args.expectedReturn,
      expectedValue: args.expectedValue,
      marketRegime: args.marketRegime,
      modelVersion: args.modelVersion,
      signalTime: args.signalTime,
      openTime: now,
      status: "open",
      exitPrice: undefined,
      exitTime: undefined,
      exitReason: undefined,
      realizedPnl: undefined,
      fees: undefined,
      slippage: undefined,
      reasonCodes: args.reasonCodes,
      summary: args.summary,
      createdAt: now,
      updatedAt: now,
    });

    return trade;
  },
});

// Close an arena trade
export const closeTrade = mutation({
  args: {
    tradeId: v.id("arenaTrades"),
    exitPrice: v.number(),
    exitReason: v.string(),
    realizedPnl: v.number(),
    fees: v.number(),
    slippage: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const trade = await ctx.db.get(args.tradeId);
    if (!trade || trade.userId !== userId) throw new Error("Trade not found");

    await ctx.db.patch(args.tradeId, {
      exitPrice: args.exitPrice,
      exitTime: Date.now(),
      exitReason: args.exitReason,
      status: "closed",
      realizedPnl: args.realizedPnl,
      fees: args.fees,
      slippage: args.slippage,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Update trailing stop
export const updateTrailingStop = mutation({
  args: {
    tradeId: v.id("arenaTrades"),
    trailingStop: v.number(),
    stopLoss: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const trade = await ctx.db.get(args.tradeId);
    if (!trade || trade.userId !== userId) throw new Error("Trade not found");

    await ctx.db.patch(args.tradeId, {
      trailingStop: args.trailingStop,
      stopLoss: args.stopLoss,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// ── Arena Signals ────────────────────────────────────────

export const listSignals = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const signals = await ctx.db
      .query("arenaSignals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit || 50);

    return signals;
  },
});

export const recordSignal = mutation({
  args: {
    signalId: v.string(),
    symbol: v.string(),
    exchange: v.string(),
    side: v.string(),
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
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();
    const signal = await ctx.db.insert("arenaSignals", {
      userId,
      signalId: args.signalId,
      symbol: args.symbol,
      exchange: args.exchange,
      side: args.side,
      strategy: args.strategy,
      timeframe: args.timeframe,
      entry: args.entry,
      stopLoss: args.stopLoss,
      takeProfit: args.takeProfit,
      riskReward: args.riskReward,
      modelProbability: args.modelProbability,
      expectedValue: args.expectedValue,
      marketRegime: args.marketRegime,
      modelVersion: args.modelVersion,
      reasonCodes: args.reasonCodes,
      summary: args.summary,
      status: args.status,
      createdAt: now,
    });

    return signal;
  },
});
