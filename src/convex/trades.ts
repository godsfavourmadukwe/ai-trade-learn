import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Get trades for a strategy
export const listByStrategy = query({
  args: { strategyId: v.id("strategies"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return [];

    const trades = await ctx.db
      .query("trades")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(args.limit || 50);

    return trades;
  },
});

// Get open trades
export const getOpenTrades = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return [];

    const trades = await ctx.db
      .query("trades")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .collect();

    return trades.filter((t) => t.status === "open");
  },
});

// Get trade summary
export const getTradeSummary = query({
  args: { strategyId: v.id("strategies"), period: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return null;

    const now = Date.now();
    let cutoff = now;

    // Calculate period cutoff
    if (args.period === "day") {
      cutoff = now - 24 * 60 * 60 * 1000;
    } else if (args.period === "week") {
      cutoff = now - 7 * 24 * 60 * 60 * 1000;
    } else if (args.period === "month") {
      cutoff = now - 30 * 24 * 60 * 60 * 1000;
    }

    const trades = await ctx.db
      .query("trades")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .collect();

    const filteredTrades = trades.filter((t) => t.entryTime >= cutoff);
    const closedTrades = filteredTrades.filter((t) => t.status === "closed");
    const winningTrades = closedTrades.filter((t) => (t.netPnL || 0) > 0);
    const losingTrades = closedTrades.filter((t) => (t.netPnL || 0) <= 0);

    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.netPnL || 0), 0);
    const totalFees = closedTrades.reduce((sum, t) => sum + (t.fees || 0), 0);

    // Calculate win/loss streaks
    let currentStreak = 0;
    let maxWinStreak = 0;
    let maxLoseStreak = 0;
    let tempStreak = 0;

    for (const trade of closedTrades) {
      if ((trade.netPnL || 0) > 0) {
        if (tempStreak >= 0) {
          tempStreak++;
        } else {
          maxLoseStreak = Math.max(maxLoseStreak, Math.abs(tempStreak));
          tempStreak = 1;
        }
        maxWinStreak = Math.max(maxWinStreak, tempStreak);
      } else {
        if (tempStreak <= 0) {
          tempStreak--;
        } else {
          maxWinStreak = Math.max(maxWinStreak, tempStreak);
          tempStreak = -1;
        }
        maxLoseStreak = Math.max(maxLoseStreak, Math.abs(tempStreak));
      }
      currentStreak = tempStreak;
    }

    return {
      totalTrades: filteredTrades.length,
      openTrades: filteredTrades.filter((t) => t.status === "open").length,
      closedTrades: closedTrades.length,
      winRate: closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
      totalPnL,
      avgWin: winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + (t.netPnL || 0), 0) / winningTrades.length
        : 0,
      avgLoss: losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + (t.netPnL || 0), 0) / losingTrades.length
        : 0,
      totalFees,
      maxWinStreak,
      maxLoseStreak,
      currentStreak,
      expectancy: closedTrades.length > 0 ? totalPnL / closedTrades.length : 0,
    };
  },
});

// Record a trade
export const recordTrade = mutation({
  args: {
    strategyId: v.id("strategies"),
    signalId: v.id("signals"),
    symbol: v.string(),
    mode: v.string(),
    entryPrice: v.number(),
    quantity: v.number(),
    direction: v.string(),
    stopLoss: v.number(),
    takeProfit: v.number(),
    trailingStop: v.optional(v.number()),
    entryTime: v.number(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();
    const trade = await ctx.db.insert("trades", {
      strategyId: args.strategyId,
      userId,
      signalId: args.signalId,
      symbol: args.symbol,
      mode: args.mode,
      entryPrice: args.entryPrice,
      quantity: args.quantity,
      direction: args.direction,
      stopLoss: args.stopLoss,
      takeProfit: args.takeProfit,
      trailingStop: args.trailingStop,
      entryTime: args.entryTime,
      status: args.status,
      createdAt: now,
      updatedAt: now,
    });

    return trade;
  },
});

// Update trade (for closing, trailing stop, etc.)
export const updateTrade = mutation({
  args: {
    tradeId: v.id("trades"),
    updates: v.object({
      exitPrice: v.optional(v.number()),
      exitTime: v.optional(v.number()),
      holdingPeriod: v.optional(v.number()),
      grossPnL: v.optional(v.number()),
      netPnL: v.optional(v.number()),
      fees: v.optional(v.number()),
      slippageCost: v.optional(v.number()),
      status: v.optional(v.string()),
      exitReason: v.optional(v.string()),
      trailingStop: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const trade = await ctx.db.get(args.tradeId);
    if (!trade || trade.userId !== userId) throw new Error("Trade not found");

    await ctx.db.patch(args.tradeId, {
      ...args.updates,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Get signals for a strategy
export const getSignals = query({
  args: {
    strategyId: v.id("strategies"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return [];

    const signals = await ctx.db
      .query("signals")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(args.limit || 100);

    return signals;
  },
});
