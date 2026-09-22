// ============================================================
// TEMPORARY internal debug panel for the stock live pipeline.
//
// Shows the full path: provider → backend relay → frontend
// state → chart, with timestamps at every hop so any break is
// immediately visible.
//
// Visibility: dev builds + `?streamDebug` query param.
// Hidden from normal production users.
// ============================================================

import { useEffect, useState } from "react";
import type { StreamHealth } from "@/lib/stocks/stream";
import type { StockStreamRow } from "@/lib/stocks/stream";

export function isStreamDebugVisible(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env.DEV) return true;
  return new URLSearchParams(window.location.search).has("streamDebug");
}

function ago(ms: number, now: number): string {
  if (!ms || ms <= 0) return "never";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return `${s.toFixed(1)}s ago`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s ago`;
}

function clock(ms: number): string {
  if (!ms || ms <= 0) return "—";
  return new Date(ms).toLocaleTimeString();
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <span className={`text-right ${tone ?? "text-zinc-200"}`}>{value}</span>
    </div>
  );
}

export interface StreamDebugPanelProps {
  symbol: string;
  price: number | null;
  health: StreamHealth;
  clientHealth: StreamHealth | null;
  backend: StockStreamRow | null;
  lastFrontendUpdate: number;
  chartPoints: number;
}

export function StreamDebugPanel({
  symbol,
  price,
  health,
  clientHealth,
  backend,
  lastFrontendUpdate,
  chartPoints,
}: StreamDebugPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const heartbeatAt = backend?.heartbeatAt ?? 0;
  const backendConnected =
    backend != null &&
    backend.desired &&
    heartbeatAt > 0 &&
    now - heartbeatAt < 45_000 &&
    backend.status !== "error" &&
    backend.status !== "stopped";

  const clientWsUp = Boolean(clientHealth?.wsConnected);
  const clientMsgs = clientHealth?.messagesReceived ?? 0;
  const backendMsgs = backend?.messagesReceived ?? 0;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 font-mono text-[11px] leading-relaxed">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-amber-300 tracking-wide">
          STREAM DEBUG — internal diagnostics
        </span>
        <span className="text-zinc-500">
          updated {clock(now)} · status <span className="text-amber-200">{health.status.toUpperCase()}</span>
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-x-8 gap-y-1">
        <Line
          label="Provider:"
          value={`yahoo-streamer · relay ${backendConnected ? "CONNECTED" : "DISCONNECTED"} (${backend?.status ?? "no-row"}${backend?.desired ? "" : ", not desired"})`}
          tone={backendConnected ? "text-emerald-400" : "text-rose-400"}
        />
        <Line
          label="WebSocket (browser):"
          value={clientWsUp ? "CONNECTED" : "DISCONNECTED"}
          tone={clientWsUp ? "text-emerald-400" : "text-rose-400"}
        />
        <Line label="Symbol:" value={`${symbol} (subscribed: ${health.subscribedSymbol})`} />
        <Line
          label="Last price:"
          value={price != null ? `$${price.toFixed(2)} (relay: ${backend?.price != null ? "$" + backend.price.toFixed(2) : "—"})` : "—"}
          tone="text-white font-bold"
        />
        <Line
          label="Last tick:"
          value={`${ago(health.lastTickAt, now)} · provider delay ${health.feedDelayMs > 0 ? `${Math.round(health.feedDelayMs / 1000)}s` : "—"}`}
          tone={health.feedDelayMs > 90_000 ? "text-rose-400" : "text-emerald-400"}
        />
        <Line
          label="Messages received:"
          value={`client ${clientMsgs} + backend ${backendMsgs} = ${clientMsgs + backendMsgs}`}
        />
        <Line
          label="Last server update:"
          value={`tick ${clock(backend?.receivedAt ?? 0)} (${ago(backend?.receivedAt ?? 0, now)}) · heartbeat ${ago(heartbeatAt, now)} · writes ${backend?.ticksWritten ?? 0}`}
        />
        <Line
          label="Last frontend update:"
          value={`${clock(lastFrontendUpdate)} (${ago(lastFrontendUpdate, now)})`}
          tone={lastFrontendUpdate > 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <Line label="Chart points:" value={`${chartPoints}`} />
        <Line
          label="Reconnects:"
          value={`client ${clientHealth?.reconnectCount ?? 0} + backend ${backend?.reconnectCount ?? 0}`}
        />
        <Line label="Data age:" value={health.dataAgeMs >= 0 ? `${Math.round(health.dataAgeMs / 1000)}s` : "no data"} />
        <Line label="Market:" value={health.marketStatus.label} />
        <Line
          label="Last error:"
          value={health.lastError ?? "none"}
          tone={health.lastError ? "text-rose-400" : "text-zinc-500"}
        />
      </div>
    </div>
  );
}
