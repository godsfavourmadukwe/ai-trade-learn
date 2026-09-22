// ============================================================
// STOCK STREAM — Data store (default Convex runtime)
//
// Queries/mutations backing the backend stream relay. The Node
// relay action (stockStream.ts) cannot define mutations itself
// (Convex allows only actions in "use node" modules), so all
// table access lives here.
//
// The frontend subscribes to `get` reactively: every normalized
// provider tick written by the relay updates clients with no
// page refresh.
// ============================================================

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const PROVIDER = "yahoo-streamer";
const DESIRED_TTL_MS = 150_000; // client renews desiredAt every 60s
const CLAIM_STALE_MS = 60_000; // relay claim older than this can be replaced
const MAX_DESIRED_RELAYS = 3; // cap concurrent relays

const VALID_SYMBOL = /^[A-Za-z0-9.\-^=]{1,20}$/;

function normalizeSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase();
  if (!symbol || !VALID_SYMBOL.test(symbol)) return null;
  return symbol;
}

async function readRow(
  ctx: QueryCtx | MutationCtx,
  symbol: string,
): Promise<Doc<"stockStream"> | null> {
  const row = await ctx.db
    .query("stockStream")
    .withIndex("by_symbol", (q) => q.eq("symbol", symbol))
    .unique();
  return row;
}

// ── Public API ────────────────────────────────────────────

/** Reactive tick + health row for one symbol. The frontend subscribes to this. */
export const get = query({
  args: { symbol: v.string() },
  handler: async (ctx, args): Promise<Doc<"stockStream"> | null> => {
    const symbol = normalizeSymbol(args.symbol);
    if (!symbol) return null;
    return await readRow(ctx, symbol);
  },
});

/** Client marks a symbol as no longer desired (page unmount / symbol switch). */
export const stop = mutation({
  args: { symbol: v.string() },
  handler: async (ctx, args) => {
    const symbol = normalizeSymbol(args.symbol);
    if (!symbol) return;
    const row = await readRow(ctx, symbol);
    if (!row) return;
    ctx.db.patch(row._id, { desired: false, desiredAt: 0, status: "stopped" });
  },
});

/** Client renewal heartbeat — keeps the relay alive while a page is open. */
export const renew = mutation({
  args: { symbol: v.string() },
  handler: async (ctx, args) => {
    const symbol = normalizeSymbol(args.symbol);
    if (!symbol) return;
    const row = await readRow(ctx, symbol);
    if (!row || !row.desired) return;
    ctx.db.patch(row._id, { desiredAt: Date.now() });
  },
});

// ── Internal helpers used by the relay action ─────────────

export const setDesired = internalMutation({
  args: { symbol: v.string(), desired: v.boolean() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await readRow(ctx, args.symbol);
    if (!row) {
      ctx.db.insert("stockStream", {
        symbol: args.symbol,
        provider: PROVIDER,
        status: "connecting",
        desired: args.desired,
        desiredAt: args.desired ? now : 0,
        messagesReceived: 0,
        ticksWritten: 0,
        reconnectCount: 0,
        updatedAt: now,
      });
      return;
    }
    ctx.db.patch(row._id, {
      desired: args.desired,
      desiredAt: args.desired ? now : 0,
      ...(args.desired ? {} : { status: "stopped" }),
    });
  },
});

export const getRow = internalQuery({
  args: { symbol: v.string() },
  handler: async (ctx, args) => await readRow(ctx, args.symbol),
});

export const countFreshDesired = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DESIRED_TTL_MS;
    const rows = await ctx.db
      .query("stockStream")
      .withIndex("by_desired", (q) => q.eq("desired", true).gte("desiredAt", cutoff))
      .take(MAX_DESIRED_RELAYS + 1);
    return rows.length;
  },
});

/** Claim exclusive relay ownership for this symbol. Duplicates exit. */
export const claimRelay = internalMutation({
  args: { symbol: v.string(), instanceId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await readRow(ctx, args.symbol);
    if (!row) return { granted: false as const, reason: "no-row" };
    const claimFresh =
      row.relayInstance != null &&
      row.relayInstance !== args.instanceId &&
      row.relayStartedAt != null &&
      now - row.relayStartedAt < CLAIM_STALE_MS;
    if (claimFresh) return { granted: false as const, reason: "claimed" };
    ctx.db.patch(row._id, {
      relayInstance: args.instanceId,
      relayStartedAt: now,
      heartbeatAt: now,
      status: "connecting",
    });
    return { granted: true as const };
  },
});

export const releaseRelay = internalMutation({
  args: {
    symbol: v.string(),
    instanceId: v.string(),
    status: v.string(),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await readRow(ctx, args.symbol);
    if (!row || row.relayInstance !== args.instanceId) return; // ownership moved on
    ctx.db.patch(row._id, {
      relayInstance: undefined,
      relayStartedAt: 0,
      heartbeatAt: Date.now(),
      status: args.status,
      ...(args.lastError ? { lastError: args.lastError } : {}),
      updatedAt: Date.now(),
    });
  },
});

/** Relay liveness heartbeat — carries counters/status between ticks. */
export const heartbeat = internalMutation({
  args: {
    symbol: v.string(),
    instanceId: v.string(),
    status: v.string(),
    messagesReceived: v.number(),
    reconnectCount: v.number(),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await readRow(ctx, args.symbol);
    if (!row || row.relayInstance !== args.instanceId) return;
    ctx.db.patch(row._id, {
      relayStartedAt: Date.now(), // refresh claim so ensure() doesn't double-start
      heartbeatAt: Date.now(),
      status: args.status,
      messagesReceived: args.messagesReceived,
      reconnectCount: args.reconnectCount,
      ...(args.lastError ? { lastError: args.lastError } : {}),
      updatedAt: Date.now(),
    });
  },
});

/** Write one normalized provider tick. Called by the relay (throttled). */
export const applyTick = internalMutation({
  args: {
    symbol: v.string(),
    instanceId: v.string(),
    messagesReceived: v.number(),
    reconnectCount: v.number(),
    price: v.number(),
    change: v.optional(v.number()),
    changePercent: v.optional(v.number()),
    open: v.optional(v.number()),
    previousClose: v.optional(v.number()),
    dayHigh: v.optional(v.number()),
    dayLow: v.optional(v.number()),
    dayVolume: v.optional(v.number()),
    bid: v.optional(v.number()),
    ask: v.optional(v.number()),
    marketHours: v.optional(v.number()),
    currency: v.optional(v.string()),
    exchange: v.optional(v.string()),
    providerTime: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await readRow(ctx, args.symbol);
    if (!row || row.relayInstance !== args.instanceId) return;
    const now = Date.now();
    ctx.db.patch(row._id, {
      provider: PROVIDER,
      status: "live",
      price: args.price,
      change: args.change,
      changePercent: args.changePercent,
      open: args.open,
      previousClose: args.previousClose,
      dayHigh: args.dayHigh,
      dayLow: args.dayLow,
      dayVolume: args.dayVolume,
      bid: args.bid,
      ask: args.ask,
      marketHours: args.marketHours,
      currency: args.currency,
      exchange: args.exchange,
      providerTime: args.providerTime,
      receivedAt: now,
      feedDelayMs: Math.max(0, now - args.providerTime),
      messagesReceived: args.messagesReceived,
      ticksWritten: (row.ticksWritten ?? 0) + 1,
      reconnectCount: args.reconnectCount,
      relayStartedAt: now,
      heartbeatAt: now,
      updatedAt: now,
    });
  },
});

/** Whether a client still wants this relay (within the renewal TTL). */
export const desiredStillFresh = internalQuery({
  args: { symbol: v.string() },
  handler: async (ctx, args) => {
    const row = await readRow(ctx, args.symbol);
    if (!row || !row.desired) return false;
    return Date.now() - row.desiredAt < DESIRED_TTL_MS;
  },
});
