// ============================================================
// STOCK STREAM — Combined stream health (pure)
//
// Merges the browser-socket health and the backend relay row
// into ONE honest status shown by the badge, footer and debug
// panel. LIVE is only ever shown when provider data arrived
// recently AND the provider's own timestamps are fresh AND the
// market is open. Otherwise: MARKET CLOSED / CONNECTING /
// RECONNECTING / STALE / DELAYED / ERROR.
//
// No side effects — exported for unit testing.
// ============================================================

import type { StreamHealth, StreamStatus } from "./engine";
import { getMarketStatus } from "./market-hours";
import type { Doc } from "@/convex/_generated/dataModel";

/** One row of the backend stream relay table. */
export type StockStreamRow = Doc<"stockStream">;

const STALE_AFTER_MS = 30_000;
const DISCONNECTED_AFTER_MS = 5_000;
const FEED_DELAY_THRESHOLD_MS = 90_000;
const BACKEND_HEARTBEAT_FRESH_MS = 45_000;

export function combineStreamHealth(
  client: StreamHealth | null,
  backend: StockStreamRow | null | undefined,
  symbol: string,
  now: number,
): StreamHealth {
  const sym = symbol.toUpperCase();
  const row = backend && backend.symbol === sym ? backend : null;

  const clientTickAt = client?.lastTickAt ?? 0;
  const backendTickAt = row?.receivedAt ?? 0;
  const lastTickAt = Math.max(clientTickAt, backendTickAt);
  const backendFresher = backendTickAt >= clientTickAt;

  const backendHeartbeatAt = row?.heartbeatAt ?? 0;
  const backendConnected =
    row != null &&
    row.desired &&
    backendHeartbeatAt > 0 &&
    now - backendHeartbeatAt < BACKEND_HEARTBEAT_FRESH_MS &&
    row.status !== "error" &&
    row.status !== "stopped";

  const wsConnected = Boolean(client?.wsConnected) || backendConnected;

  const feedDelayMs = backendFresher ? (row?.feedDelayMs ?? 0) : (client?.feedDelayMs ?? 0);
  const providerTime = backendFresher ? (row?.providerTime ?? 0) : (client?.providerTime ?? 0);

  const market = client?.marketStatus ?? getMarketStatus(now, row?.exchange ?? null);
  const dataAgeMs = lastTickAt > 0 ? now - lastTickAt : -1;

  let status: StreamStatus;
  if (!market.isOpen) {
    // Closed market: prices legitimately do not change.
    status = "market-closed";
  } else if (lastTickAt === 0) {
    // No data yet — surface transport truth instead of guessing.
    if (client?.status === "error" || row?.status === "error") status = "error";
    else if (client?.status === "reconnecting" || row?.status === "reconnecting") {
      status = "reconnecting";
    } else status = "connecting";
  } else if (!wsConnected && dataAgeMs > DISCONNECTED_AFTER_MS) {
    // Transport down (both paths) → RECONNECTING, recovery is automatic.
    status = "reconnecting";
  } else if (dataAgeMs > STALE_AFTER_MS) {
    // Socket looks up but no fresh provider data → STALE, never LIVE.
    status = "stale";
  } else if (feedDelayMs > FEED_DELAY_THRESHOLD_MS) {
    // Data arrives, but provider timestamps lag → DELAYED, never LIVE.
    status = "delayed";
  } else {
    status = "live";
  }

  return {
    status,
    subscribedSymbol: sym,
    lastTickAt,
    dataAgeMs,
    reconnectCount: (client?.reconnectCount ?? 0) + (row?.reconnectCount ?? 0),
    errors: client?.errors ?? 0,
    lastError: row?.lastError ?? client?.lastError ?? null,
    marketStatus: market,
    wsConnected,
    provider: row?.provider ?? "yahoo-streamer",
    messagesReceived: (client?.messagesReceived ?? 0) + (row?.messagesReceived ?? 0),
    providerTime,
    feedDelayMs,
  };
}
