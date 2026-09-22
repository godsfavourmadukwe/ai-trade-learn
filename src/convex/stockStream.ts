"use node";

// ============================================================
// STOCK STREAM — Backend real-time relay (Node actions)
//
// Pipeline (backend-first, no secrets in the browser):
//
//   Yahoo streamer WebSocket  →  relay action (this file)
//     → protobuf parser        →  symbol normalization
//       → stockStream table    →  reactive useQuery
//         → frontend state     →  live chart + price
//
// Table access lives in stockStreamStore.ts (Convex allows only
// actions in "use node" modules).
//
// The relay is a self-rescheduling Node action:
//   • connects to wss://streamer.finance.yahoo.com
//   • subscribes to the requested symbol
//   • decodes PricingData protobuf frames (pure-JS parser)
//   • throttles normalized ticks into the stockStream table
//   • connection timeout, inbound watchdog (silent-death
//     detection), exponential backoff, auto-resubscribe
//   • exits after a 7-minute budget and reschedules itself
//     while a client still desires the stream (renews every
//     60s), so no zombie relays survive a closed browser
//
// Every stage logs internally (Convex function logs):
//   provider connection · subscription · raw message ·
//   parsed symbol · price · timestamp · reconnects
//
// NEVER fabricates data: the row only ever contains values
// received from the provider, plus health timestamps.
// ============================================================

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseStreamerMessage } from "../lib/stocks/stream/protobuf";
import { getMarketStatus } from "../lib/stocks/stream/market-hours";

const WS_URL = "wss://streamer.finance.yahoo.com";

const RELAY_BUDGET_MS = 7 * 60_000; // action lifetime cap (well under any timeout)
const OPEN_TIMEOUT_MS = 15_000; // connection timeout → treat as failure
const WRITE_INTERVAL_MS = 700; // throttle table writes (≤ ~1.4/s)
const HEARTBEAT_INTERVAL_MS = 30_000; // relay liveness write (also refreshes claim)
const SILENT_AFTER_MS = 45_000; // no WS message while market open → reconnect
const DESIRED_TTL_MS = 150_000; // client must renew desiredAt within 2.5 min
const CLAIM_STALE_MS = 60_000; // relay claim older than this can be replaced
const CHECK_INTERVAL_MS = 5_000; // watchdog loop period
const MAX_DESIRED_RELAYS = 3; // cap concurrent relays
const CLOSED_MARKET_IDLE_MS = 10 * 60_000; // overnight: exit + retry in 10 min
const LONG_SILENT_MS = 5 * 60_000; // never-delivered connection: wait 5 min before forcing a reconnect
const FORCE_COOLDOWN_MS = 4.5 * 60_000; // rate-limit forced reconnects (no close storms)

const VALID_SYMBOL = /^[A-Za-z0-9.\-^=]{1,20}$/;

function normalizeSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase();
  if (!symbol || !VALID_SYMBOL.test(symbol)) return null;
  return symbol;
}

/**
 * Ensure a relay is running for this symbol. Called by the frontend on
 * mount and on every symbol switch. Idempotent + race-safe via claim.
 */
export const ensure = action({
  args: { symbol: v.string() },
  handler: async (ctx, args) => {
    const symbol = normalizeSymbol(args.symbol);
    if (!symbol) return { ok: false as const, error: `Invalid symbol: "${args.symbol}"` };

    await ctx.runMutation(internal.stockStreamStore.setDesired, { symbol, desired: true });
    const row = await ctx.runQuery(internal.stockStreamStore.getRow, { symbol });
    const now = Date.now();

    const claimFresh =
      row?.relayInstance != null &&
      row.relayStartedAt != null &&
      now - row.relayStartedAt < CLAIM_STALE_MS;
    if (claimFresh) {
      console.log(`[stockStream] ensure ${symbol}: relay already running`);
      return { ok: true as const, started: false as const, reason: "already-running" };
    }

    const freshDesired = await ctx.runQuery(internal.stockStreamStore.countFreshDesired, {});
    // NOTE: count already includes this symbol (setDesired ran above), so the
    // cap allows MAX symbols total — reject only when someone else pushed us over.
    if (freshDesired > MAX_DESIRED_RELAYS) {
      console.log(`[stockStream] ensure ${symbol}: relay cap reached (${freshDesired})`);
      return { ok: true as const, started: false as const, reason: "relay-cap" };
    }

    console.log(`[stockStream] ensure ${symbol}: scheduling relay`);
    await ctx.scheduler.runAfter(0, internal.stockStream.relay, { symbol });
    return { ok: true as const, started: true as const };
  },
});

// ── Diagnostic probe ────────────────────────────────────
// One-shot observability action: opens a fresh streamer socket
// from inside Convex, subscribes, and RETURNS the full event
// trace (open / messages / close codes / reconnects) so backend
// connectivity can be verified without guessing.

export const probe = action({
  args: { symbol: v.string(), durationMs: v.optional(v.number()) },
  handler: async (_ctx, args) => {
    const symbol = (args.symbol ?? "").trim().toUpperCase();
    const duration = Math.min(args.durationMs ?? 40_000, 90_000);
    const events: string[] = [];
    const t0 = Date.now();
    const at = () => `${Date.now() - t0}ms`;
    const matched: string[] = [];
    let messages = 0;

    if (typeof WebSocket !== "function") {
      return { ok: false as const, error: "runtime lacks WebSocket", events, messages, matched };
    }

    const reason = await new Promise<string>((resolve) => {
      let ws: WebSocket | null = null;
      let done = false;
      const finish = (why: string) => {
        if (done) return;
        done = true;
        events.push(`${at()} finish: ${why}`);
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        resolve(why);
      };

      const connect = (attempt: number, openedBefore: boolean) => {
        events.push(`${at()} connect #${attempt}`);
        let opened = openedBefore;
        let openedAt = 0;
        try {
          ws = new WebSocket(WS_URL);
        } catch (e) {
          events.push(`${at()} construct error: ${e instanceof Error ? e.message : String(e)}`);
          finish("construct-threw");
          return;
        }
        const s = ws;
        s.onopen = () => {
          opened = true;
          openedAt = Date.now();
          events.push(`${at()} open #${attempt}`);
          const sub = JSON.stringify({ subscribe: [symbol] });
          s.send(sub);
          events.push(`${at()} sent ${sub}`);
        };
        s.onmessage = (ev) => {
          messages++;
          const raw = String(ev.data);
          if (messages <= 3) events.push(`${at()} msg#${messages} len=${raw.length} head=${raw.slice(0, 60)}`);
          const ticks = parseStreamerMessage(raw);
          for (const t of ticks) {
            if (matched.length < 5) matched.push(`${t.id}@${t.price} providerTime=${t.time}`);
          }
          if (messages >= 10) finish("got-10-messages");
        };
        s.onerror = () => events.push(`${at()} error-event`);
        s.onclose = (ev) => {
          events.push(
            `${at()} close #${attempt} code=${ev.code} reason=${JSON.stringify(ev.reason ?? "")} wasClean=${ev.wasClean} opened=${opened} uptime=${opened ? Date.now() - openedAt : 0}ms`,
          );
          if (done) return;
          if (attempt < 3) {
            const d = 1000 * attempt;
            events.push(`${at()} reconnect in ${d}ms`);
            setTimeout(() => {
              if (!done) connect(attempt + 1, false);
            }, d);
          } else {
            finish("3-closes-given-up");
          }
        };
      };

      connect(1, false);
      setTimeout(() => finish(`duration-elapsed messages=${messages}`), duration);
    });

    return {
      ok: true as const,
      symbol,
      messages,
      matched,
      result: reason,
      events: events.slice(0, 60),
    };
  },
});

// ── The relay loop ──────────────────────────────────────────

export const relay = internalAction({
  args: { symbol: v.string() },
  handler: async (ctx, args) => {
    const symbol = args.symbol;
    const instanceId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const claim = await ctx.runMutation(internal.stockStreamStore.claimRelay, {
      symbol,
      instanceId,
    });
    if (!claim.granted) {
      console.log(`[stockStream] relay ${symbol}: not granted (${claim.reason}) — exiting`);
      return;
    }

    console.log(`[stockStream] relay start symbol=${symbol} instance=${instanceId}`);

    if (typeof WebSocket !== "function") {
      // Honest failure — never fake a feed.
      console.log(`[stockStream] relay ${symbol}: FATAL — runtime lacks WebSocket`);
      await ctx.runMutation(internal.stockStreamStore.heartbeat, {
        symbol,
        instanceId,
        status: "error",
        messagesReceived: 0,
        reconnectCount: 0,
        lastError: "Node runtime has no WebSocket support — backend stream unavailable",
      });
      await ctx.runMutation(internal.stockStreamStore.releaseRelay, {
        symbol,
        instanceId,
        status: "error",
        lastError: "runtime lacks WebSocket support",
      });
      return;
    }

    let ws: WebSocket | null = null;
    let wsOpen = false;
    let connecting = false;
    let messages = 0;
    let messagesOnConn = 0; // messages received on the CURRENT socket
    let connOpenedAt = 0;
    let lastForceCloseAt = 0;
    let reconnects = 0;
    let parseErrors = 0;
    let firstTickLogged = false;
    let lastMessageAt = Date.now();
    let lastWriteAt = 0;
    let lastHeartbeatAt = 0;
    let lastDesiredCheckAt = 0;
    let attempt = 0;
    let lastError: string | null = null;
    let exitReason: string | null = null;
    let exitStatus = "stopped";
    const startedAt = Date.now();

    const log = (msg: string) => console.log(`[stockStream] ${symbol} ${msg}`);

    const cleanupSocket = () => {
      if (!ws) return;
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
      wsOpen = false;
    };

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;

    const sendHeartbeat = (status: string, err?: string) => {
      void ctx.runMutation(internal.stockStreamStore.heartbeat, {
        symbol,
        instanceId,
        status,
        messagesReceived: messages,
        reconnectCount: reconnects,
        lastError: err,
      }).catch(() => undefined);
    };

    const scheduleReconnect = (why: string) => {
      if (reconnectTimer || exitReason) return;
      reconnects++;
      attempt++;
      const delay = Math.min(1_000 * Math.pow(2, attempt - 1), 30_000);
      log(`reconnect #${reconnects} in ${delay}ms (${why})`);
      sendHeartbeat("reconnecting", why);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!exitReason) connect();
      }, delay);
    };

    const connect = () => {
      if (exitReason || connecting) return;
      connecting = true;
      cleanupSocket();
      log(`provider connect → ${WS_URL}`);
      let socket: WebSocket;
      try {
        socket = new WebSocket(WS_URL);
      } catch (e) {
        connecting = false;
        lastError = e instanceof Error ? e.message : String(e);
        log(`provider connect FAILED: ${lastError}`);
        scheduleReconnect(lastError);
        return;
      }
      ws = socket;

      const openTimer = setTimeout(() => {
        if (!wsOpen && !exitReason) {
          lastError = `connection timeout after ${OPEN_TIMEOUT_MS}ms`;
          log("connect timeout → closing");
          try {
            socket.close();
          } catch {
            /* ignore */
          }
        }
      }, OPEN_TIMEOUT_MS);

      socket.onopen = () => {
        wsOpen = true;
        connecting = false;
        attempt = 0;
        clearTimeout(openTimer);
        // Grace period starts at OPEN: a quiet symbol must not look
        // "silent" before the socket has had a chance to deliver.
        // (Not resetting this on reconnect caused a close storm:
        // silence stayed > threshold forever, watchdog fired every 5s.)
        connOpenedAt = Date.now();
        messagesOnConn = 0;
        lastMessageAt = Date.now();
        const sub = JSON.stringify({ subscribe: [symbol] });
        socket.send(sub);
        log(`subscription sent: ${sub}`);
        sendHeartbeat("connecting");
      };

      socket.onmessage = (ev: MessageEvent) => {
        lastMessageAt = Date.now();
        messages++;
        messagesOnConn++;
        try {
          const raw = typeof ev.data === "string" ? ev.data : "";
          if (!raw) return;
          if (messages <= 2) log(`raw message #${messages}: ${raw.slice(0, 160)}`);
          const ticks = parseStreamerMessage(raw);
          const now = Date.now();
          for (const t of ticks) {
            if (t.id.toUpperCase() !== symbol) continue; // symbol normalization guard
            if (!firstTickLogged) {
              firstTickLogged = true;
              log(
                `first tick OK symbol=${t.id} price=${t.price} providerTime=${t.time} receivedAt=${now}`,
              );
            }
            // Throttled write (first tick writes immediately via lastWriteAt=0)
            if (now - lastWriteAt < WRITE_INTERVAL_MS) continue;
            lastWriteAt = now;
            void ctx.runMutation(internal.stockStreamStore.applyTick, {
              symbol,
              instanceId,
              messagesReceived: messages,
              reconnectCount: reconnects,
              price: t.price,
              change: t.change ?? undefined,
              changePercent: t.changePercent ?? undefined,
              open: t.openPrice ?? undefined,
              previousClose: t.previousClose ?? undefined,
              dayHigh: t.dayHigh ?? undefined,
              dayLow: t.dayLow ?? undefined,
              dayVolume: t.dayVolume ?? undefined,
              bid: t.bid ?? undefined,
              ask: t.ask ?? undefined,
              marketHours: t.marketHours ?? undefined,
              currency: t.currency ?? undefined,
              exchange: t.exchange ?? undefined,
              providerTime: t.time,
            }).catch((e) => {
              // Never swallow silently — surface write failures in health
              lastError = `applyTick failed: ${e instanceof Error ? e.message : String(e)}`;
              log(lastError);
            });
          }
        } catch (e) {
          parseErrors++;
          if (parseErrors <= 3) {
            lastError = e instanceof Error ? e.message : String(e);
            log(`parse error: ${lastError}`);
          }
        }
      };

      socket.onerror = () => {
        lastError = "websocket error";
        log("websocket error event");
      };

      socket.onclose = (ev) => {
        clearTimeout(openTimer);
        wsOpen = false;
        connecting = false;
        ws = null;
        const why = `socket closed (code=${ev?.code ?? "?"}${ev?.reason ? ` reason="${ev.reason}"` : ""})`;
        lastError = why;
        log(why);
        if (exitReason) return;
        scheduleReconnect(why);
      };
    };

    connect();

    watchdog = setInterval(() => {
      if (exitReason) return;
      const now = Date.now();
      const market = getMarketStatus(now, null); // relay serves US equities by default

      // Inbound watchdog — detect silently-dead sockets (no application-level
      // ping is possible over WebSocket, so inbound activity IS the heartbeat).
      // Two guards prevent false positives on quiet symbols:
      //   • silence is measured from socket OPEN (grace), not relay start
      //   • a connection that NEVER delivered waits 5 min, and forced
      //     reconnects are rate-limited to one per 4.5 min
      const silentFor = now - lastMessageAt;
      const deliveredThenSilent = messagesOnConn > 0 && silentFor > SILENT_AFTER_MS;
      const neverDelivered =
        messagesOnConn === 0 && connOpenedAt > 0 && now - connOpenedAt > LONG_SILENT_MS;
      const forceCooldownOk = now - lastForceCloseAt > FORCE_COOLDOWN_MS;
      if (wsOpen && market.isOpen && (deliveredThenSilent || neverDelivered) && forceCooldownOk) {
        lastForceCloseAt = now;
        log(`silent for ${Math.round(silentFor / 1000)}s during open market → force reconnect`);
        lastError = `silent feed (${Math.round(silentFor / 1000)}s)`;
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        // onclose → scheduleReconnect
      }

      // Overnight idle: market closed and nothing flowing → stop churning
      // sockets; exit and let the scheduler retry every 10 minutes.
      if (!market.isOpen && silentFor > CLOSED_MARKET_IDLE_MS) {
        log(`market closed + idle for ${Math.round(silentFor / 1000)}s → exiting for 10 min`);
        exitReason = "market-closed-idle";
        exitStatus = "stopped";
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        return;
      }

      // Relay heartbeat (also refreshes the claim so ensure() won't double-start)
      if (now - lastHeartbeatAt > HEARTBEAT_INTERVAL_MS) {
        lastHeartbeatAt = now;
        sendHeartbeat(
          wsOpen ? (firstTickLogged ? "live" : "connecting") : "reconnecting",
          lastError ?? undefined,
        );
      }

      // Client desire check — stop when nobody is watching
      if (now - lastDesiredCheckAt > 15_000) {
        lastDesiredCheckAt = now;
        void (async () => {
          try {
            const fresh = await ctx.runQuery(internal.stockStreamStore.desiredStillFresh, {
              symbol,
            });
            if (!fresh && !exitReason) {
              log("desired expired (no client watching) → exiting");
              exitReason = "desired-expired";
              exitStatus = "stopped";
              try {
                ws?.close();
              } catch {
                /* ignore */
              }
            }
          } catch {
            /* transient query failure — check again next cycle */
          }
        })();
      }

      // Budget cap — exit cleanly and reschedule for continuity
      if (now - startedAt > RELAY_BUDGET_MS) {
        log(`budget reached (${RELAY_BUDGET_MS / 60000} min) → rotating relay`);
        exitReason = "budget";
        exitStatus = wsOpen ? (firstTickLogged ? "live" : "connecting") : "reconnecting";
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      }
    }, CHECK_INTERVAL_MS);

    // Await exit
    await new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        if (exitReason) {
          clearInterval(iv);
          resolve();
        }
      }, 500);
      // Safety: never exceed budget by more than 30s even if checks stall
      const hardStop = setTimeout(() => {
        if (!exitReason) exitReason = "budget";
      }, RELAY_BUDGET_MS + 30_000);
      void hardStop;
    });

    // Cleanup
    if (watchdog) clearInterval(watchdog);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    cleanupSocket();
    log(`relay exit reason=${exitReason} messages=${messages} reconnects=${reconnects}`);
    await ctx.runMutation(internal.stockStreamStore.releaseRelay, {
      symbol,
      instanceId,
      status: exitStatus,
      lastError:
        exitReason === "desired-expired" || exitReason === "market-closed-idle"
          ? undefined
          : (exitReason ?? undefined),
    }).catch(() => undefined);

    // Continuity: reschedule when a client still wants the stream
    if (exitReason === "budget" || exitReason === "market-closed-idle") {
      try {
        const fresh = await ctx.runQuery(internal.stockStreamStore.desiredStillFresh, { symbol });
        if (fresh) {
          const delay = exitReason === "market-closed-idle" ? CLOSED_MARKET_IDLE_MS : 1_000;
          log(`rescheduling relay in ${delay}ms (${exitReason})`);
          await ctx.scheduler.runAfter(delay, internal.stockStream.relay, { symbol });
        }
      } catch (e) {
        log(`reschedule failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  },
});
