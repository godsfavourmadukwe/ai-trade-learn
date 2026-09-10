import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Get learning metrics for a strategy
export const getMetrics = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return null;

    const metrics = await ctx.db
      .query("learningMetrics")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .first();

    return metrics;
  },
});

// Initialize learning metrics for a strategy
export const initMetrics = mutation({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Strategy not found");

    const now = Date.now();
    const metrics = await ctx.db.insert("learningMetrics", {
      strategyId: args.strategyId,
      userId,
      totalDecisions: 0,
      correctDecisions: 0,
      accuracy: 0,
      regimePerformance: {
        trending: { wins: 0, losses: 0, expectancy: 0 },
        ranging: { wins: 0, losses: 0, expectancy: 0 },
        high_volatility: { wins: 0, losses: 0, expectancy: 0 },
        low_volatility: { wins: 0, losses: 0, expectancy: 0 },
      },
      insights: [],
      confidence: 50, // Start at 50%
      lastUpdated: now,
      createdAt: now,
      updatedAt: now,
    });

    return metrics;
  },
});

// Update learning metrics after a trade
export const recordOutcome = mutation({
  args: {
    strategyId: v.id("strategies"),
    regime: v.string(),
    pnl: v.number(),
    isCorrect: v.boolean(),
    insight: v.optional(v.object({
      type: v.string(),
      description: v.string(),
      impact: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const metrics = await ctx.db
      .query("learningMetrics")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .first();

    if (!metrics) throw new Error("Learning metrics not found");

    const now = Date.now();
    const regime = args.regime as keyof typeof metrics.regimePerformance;
    const regimeData = metrics.regimePerformance[regime] || { wins: 0, losses: 0, expectancy: 0 };

    // Update regime performance
    const newRegimeData = {
      wins: regimeData.wins + (args.isCorrect ? 1 : 0),
      losses: regimeData.losses + (args.isCorrect ? 0 : 1),
      expectancy: regimeData.expectancy + args.pnl,
    };

    // Update overall metrics
    const newTotalDecisions = metrics.totalDecisions + 1;
    const newCorrectDecisions = metrics.correctDecisions + (args.isCorrect ? 1 : 0);

    // Calculate confidence based on recent performance
    const recentAccuracy = newCorrectDecisions / newTotalDecisions;
    const newConfidence = Math.min(100, Math.max(0, recentAccuracy * 100));

    // Add insight if provided
    const insights = [...metrics.insights];
    if (args.insight) {
      insights.push({
        timestamp: now,
        ...args.insight,
      });
      // Keep only last 50 insights
      if (insights.length > 50) {
        insights.splice(0, insights.length - 50);
      }
    }

    await ctx.db.patch(metrics._id, {
      totalDecisions: newTotalDecisions,
      correctDecisions: newCorrectDecisions,
      accuracy: recentAccuracy,
      regimePerformance: {
        ...metrics.regimePerformance,
        [regime]: newRegimeData,
      },
      insights,
      confidence: newConfidence,
      lastUpdated: now,
      updatedAt: now,
    });

    return { success: true };
  },
});

// Get learning insights
export const getInsights = query({
  args: { strategyId: v.id("strategies"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const metrics = await ctx.db
      .query("learningMetrics")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .first();

    if (!metrics) return [];

    return metrics.insights
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, args.limit || 20);
  },
});

// Get risk events for a user
export const getRiskEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const events = await ctx.db
      .query("riskEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit || 50);

    return events;
  },
});

// Record a risk event
export const recordRiskEvent = mutation({
  args: {
    strategyId: v.optional(v.id("strategies")),
    eventType: v.string(),
    severity: v.string(),
    message: v.string(),
    metadata: v.optional(v.object({
      currentLoss: v.number(),
      limit: v.number(),
      positionCount: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const event = await ctx.db.insert("riskEvents", {
      userId,
      strategyId: args.strategyId,
      timestamp: Date.now(),
      eventType: args.eventType,
      severity: args.severity,
      message: args.message,
      metadata: args.metadata,
      resolved: false,
    });

    return event;
  },
});

// Get user settings
export const getUserSettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    return settings;
  },
});

// Update user settings
export const updateUserSettings = mutation({
  args: {
    theme: v.optional(v.string()),
    defaultSymbol: v.optional(v.string()),
    defaultTimeframe: v.optional(v.string()),
    emailNotifications: v.optional(v.boolean()),
    signalAlerts: v.optional(v.boolean()),
    tradeAlerts: v.optional(v.boolean()),
    initialCapital: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (settings) {
      await ctx.db.patch(settings._id, {
        ...args,
        updatedAt: Date.now(),
      });
    } else {
      const now = Date.now();
      await ctx.db.insert("userSettings", {
        userId,
        theme: "dark",
        defaultSymbol: "BTC/USDT",
        defaultTimeframe: "15m",
        emailNotifications: true,
        signalAlerts: true,
        tradeAlerts: true,
        initialCapital: 10000,
        ...args,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});
