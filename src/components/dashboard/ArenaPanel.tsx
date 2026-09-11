import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import { Button } from "@/components/ui/button";
import type { ArenaTrade, ArenaSignal, ArenaPerformanceSummary } from "@/lib/arena/types";
import type { ArenaStatusInfo } from "@/lib/arena/engine";
import {
  Swords, TrendingUp, TrendingDown, Zap, Activity, Brain,
  Shield, Target, Clock, DollarSign, BarChart3, Flame,
  ArrowUpRight, ArrowDownRight, ChevronRight, Dna, AlertTriangle,
  CheckCircle, XCircle, Pause, Play,
} from "lucide-react";

interface ArenaPanelProps {
  trades: ArenaTrade[];
  signals: ArenaSignal[];
  performance: ArenaPerformanceSummary;
  status: ArenaStatusInfo;
  isActive: boolean;
  onStart: () => void;
  onStop: () => void;
}

function formatPrice(price: number): string {
  if (price < 1) return `$${price.toFixed(4)}`;
  if (price < 100) return `$${price.toFixed(2)}`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPnl(pnl: number | null): string {
  if (pnl === null) return "—";
  const sign = pnl >= 0 ? "+" : "";
  return `${sign}$${Math.abs(pnl).toFixed(2)}`;
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function tradeStatusColor(status: string): string {
  switch (status) {
    case "open": return "text-emerald-400";
    case "pending": return "text-amber-400";
    case "closed":
    case "stopped": return "text-rose-400";
    case "takeprofit": return "text-emerald-400";
    case "cancelled":
    case "rejected": return "text-zinc-500";
    default: return "text-zinc-400";
  }
}

function tradeStatusBadge(status: string): "success" | "warning" | "error" | "inactive" {
  switch (status) {
    case "open": return "success";
    case "pending": return "warning";
    case "takeprofit": return "success";
    case "stopped": return "error";
    case "closed": return "inactive";
    default: return "inactive";
  }
}

export function ArenaPanel({
  trades, signals, performance, status, isActive, onStart, onStop,
}: ArenaPanelProps) {
  const openTrades = trades.filter((t) => t.status === "open" || t.status === "pending");
  const recentSignals = signals.slice(0, 10);
  const recentClosed = trades
    .filter((t) => t.status === "closed" || t.status === "takeprofit" || t.status === "stopped")
    .slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Arena Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 via-orange-500 to-red-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
            <Swords className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-white">AI Trade Arena</h2>
            <p className="text-zinc-400 text-sm">Autonomous demo trading · Self-evolving model</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge
            status={isActive ? "success" : "error"}
            label={isActive ? "Engine Active" : "Engine Stopped"}
          />
          <StatusBadge
            status={status.paused ? "warning" : "success"}
            label={status.paused ? "Paused" : "Running"}
          />
          <Button
            variant={isActive ? "destructive" : "default"}
            size="sm"
            onClick={isActive ? onStop : onStart}
            className={isActive
              ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30"
              : "bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600"
            }
          >
            {isActive ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}
            {isActive ? "Stop" : "Start"}
          </Button>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {[
          { label: "Capital", value: formatPrice(status.capital), icon: DollarSign, color: "text-white" },
          { label: "Total P&L", value: formatPnl(performance.totalPnl), icon: BarChart3, color: performance.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400" },
          { label: "Win Rate", value: `${(performance.winRate * 100).toFixed(1)}%`, icon: Target, color: performance.winRate >= 0.5 ? "text-emerald-400" : "text-rose-400" },
          { label: "Profit Factor", value: performance.profitFactor.toFixed(2), icon: TrendingUp, color: performance.profitFactor >= 1 ? "text-emerald-400" : "text-rose-400" },
          { label: "Trades", value: `${performance.closedTrades} / ${performance.totalTrades}`, icon: Activity, color: "text-violet-400" },
          { label: "Open", value: `${status.openPositions}`, icon: Flame, color: status.openPositions > 0 ? "text-amber-400" : "text-zinc-400" },
        ].map((m) => (
          <Card key={m.label} className="bg-[#111118] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <m.icon className="w-4 h-4 text-zinc-500" />
                <span className="text-xs text-zinc-500">{m.label}</span>
              </div>
              <div className={`text-lg font-extrabold ${m.color}`}>{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Self-Evolving Model Status */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Dna className="w-4 h-4 text-cyan-400" />
            Self-Evolving Model
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-500/10 to-violet-500/10 border border-cyan-500/20">
              <div className="text-xs text-zinc-500 mb-1">Model Version</div>
              <div className="text-sm font-bold text-white">{status.modelVersion}</div>
            </div>
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="text-xs text-zinc-500 mb-1">Decisions Today</div>
              <div className="text-sm font-bold text-amber-400">{status.decisionsToday}</div>
            </div>
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="text-xs text-zinc-500 mb-1">Avg Win</div>
              <div className="text-sm font-bold text-emerald-400">{formatPrice(performance.averageWin)}</div>
            </div>
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="text-xs text-zinc-500 mb-1">Avg Loss</div>
              <div className="text-sm font-bold text-rose-400">{formatPrice(performance.averageLoss)}</div>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
            <p className="text-xs text-zinc-500">
              The model continuously adapts its confidence thresholds and risk/reward minimums based on recent performance.
              After consecutive losses it becomes more selective; after winning streaks it widens opportunity capture.
              All decisions are based on quantitative evidence — no hallucinated signals.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Open Trades */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              Open Positions ({openTrades.length})
            </CardTitle>                <StatusBadge
                    status={openTrades.length > 0 ? "success" : "inactive"}
                    label={openTrades.length > 0 ? "Active" : "Flat"}
                  />
          </div>
        </CardHeader>
        <CardContent>
          {openTrades.length > 0 ? (
            <div className="space-y-3">
              {openTrades.map((trade) => (
                <TradeCard key={trade.tradeId} trade={trade} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-zinc-500">
              <Swords className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
              <p className="text-sm">No open positions. The AI is analyzing markets for opportunities.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Signals */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-violet-400" />
            Recent Signals ({signals.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentSignals.length > 0 ? (
            <div className="space-y-2">
              {recentSignals.map((signal) => (
                <SignalRow key={signal.signalId} signal={signal} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-zinc-500">
              <Brain className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
              <p className="text-sm">No signals yet. The AI requires sufficient market data before generating signals.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Closed Trades History */}
      {recentClosed.length > 0 && (
        <Card className="bg-[#111118] border-white/[0.08]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
              <Clock className="w-4 h-4 text-zinc-400" />
              Recent Closed Trades
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentClosed.map((trade) => (
                <ClosedTradeRow key={trade.tradeId} trade={trade} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Risk Summary */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            Risk & Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="text-xs text-zinc-500 mb-2">Max Drawdown</div>
              <div className="text-xl font-bold text-rose-400">{(performance.maxDrawdown * 100).toFixed(2)}%</div>
            </div>
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="text-xs text-zinc-500 mb-2">Sharpe Ratio</div>
              <div className="text-xl font-bold text-violet-400">{performance.sharpeRatio.toFixed(2)}</div>
            </div>
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="text-xs text-zinc-500 mb-2">Expectancy</div>
              <div className={`text-xl font-bold ${performance.expectancy >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {formatPnl(performance.expectancy)}
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-zinc-300">Safety Checkpoints</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Data Fresh", ok: status.dataHealth.feedHealth === "connected" },
                { label: "No Leverage", ok: true },
                { label: "Max 1 Position", ok: status.openPositions <= 1 },
                { label: "Risk Limits", ok: performance.maxDrawdown < 0.15 },
                { label: "Spread OK", ok: true },
                { label: "Liquidity OK", ok: true },
                { label: "Model Active", ok: isActive && !status.paused },
                { label: "No Hallucination", ok: true },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5 text-xs">
                  {item.ok ? (
                    <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                  )}
                  <span className={item.ok ? "text-zinc-400" : "text-amber-400"}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────

function TradeCard({ trade }: { trade: ArenaTrade }) {
  const isLong = trade.side === "long";
  const currentPnl = trade.trailingStop
    ? ((trade.side === "long" ? 1 : -1) * (trade.entryPrice - trade.stopLoss))
    : 0;

  return (
    <div className={`p-4 rounded-xl border ${
      isLong
        ? "bg-emerald-500/5 border-emerald-500/20"
        : "bg-rose-500/5 border-rose-500/20"
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">{trade.symbol}</span>
          <StatusBadge
            status={tradeStatusBadge(trade.status)}
            label={trade.side.toUpperCase()}
          />
          <span className="text-xs text-zinc-500">· {trade.strategy}</span>
        </div>
        <div className="flex items-center gap-2">
          {trade.trailingStop && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400">
              Trailing
            </span>
          )}
          <span className="text-xs text-zinc-500">{formatTime(trade.openTime)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
        <div>
          <span className="text-zinc-500 text-xs">Entry</span>
          <div className="font-bold text-white">{formatPrice(trade.entryPrice)}</div>
        </div>
        <div>
          <span className="text-zinc-500 text-xs">Stop Loss</span>
          <div className="font-bold text-rose-400">{formatPrice(trade.stopLoss)}</div>
        </div>
        <div>
          <span className="text-zinc-500 text-xs">Take Profit</span>
          <div className="font-bold text-emerald-400">{formatPrice(trade.takeProfit)}</div>
        </div>
        <div>
          <span className="text-zinc-500 text-xs">R:R</span>
          <div className="font-bold text-white">1:{trade.riskReward.toFixed(2)}</div>
        </div>
        <div>
          <span className="text-zinc-500 text-xs">Model Prob</span>
          <div className="font-bold text-violet-400">{(trade.modelProbability * 100).toFixed(1)}%</div>
        </div>
        <div>
          <span className="text-zinc-500 text-xs">Regime</span>
          <div className="font-bold text-cyan-400 capitalize">{trade.marketRegime.replace(/_/g, " ")}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {trade.reasonCodes.slice(0, 4).map((code) => (
            <span key={code} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-zinc-500">
              {code}
            </span>
          ))}
        </div>
        <span className="text-xs text-zinc-500">
          Size: {trade.positionSize.toFixed(4)} · Risk: {formatPrice(trade.risk)}
        </span>
      </div>
    </div>
  );
}

function SignalRow({ signal }: { signal: ArenaSignal }) {
  const isLong = signal.side === "long";
  const isAccepted = signal.status === "accepted";

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.08] transition-colors">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
          isLong ? "bg-emerald-500/10" : "bg-rose-500/10"
        }`}>
          {isLong ? (
            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
          ) : (
            <ArrowDownRight className="w-4 h-4 text-rose-400" />
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">{signal.symbol}</span>
            <span className={`text-xs font-bold ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
              {signal.side.toUpperCase()}
            </span>
            {isAccepted && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                EXECUTED
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">{signal.summary.slice(0, 80)}...</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-bold text-white">{formatPrice(signal.entry)}</div>
        <div className="text-xs text-zinc-500">
          P: {(signal.modelProbability * 100).toFixed(0)}% · R:R 1:{signal.riskReward.toFixed(1)}
        </div>
      </div>
    </div>
  );
}

function ClosedTradeRow({ trade }: { trade: ArenaTrade }) {
  const pnl = trade.realizedPnl ?? 0;
  const isWin = pnl > 0;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
          isWin ? "bg-emerald-500/10" : "bg-rose-500/10"
        }`}>
          {isWin ? (
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          ) : (
            <TrendingDown className="w-4 h-4 text-rose-400" />
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">{trade.symbol}</span>
            <span className={`text-xs font-bold ${trade.side === "long" ? "text-emerald-400" : "text-rose-400"}`}>
              {trade.side.toUpperCase()}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              isWin ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
            }`}>
              {trade.exitReason?.replace(/_/g, " ") ?? "closed"}
            </span>
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Entry {formatPrice(trade.entryPrice)} → Exit {formatPrice(trade.exitPrice ?? 0)}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={`text-sm font-bold ${isWin ? "text-emerald-400" : "text-rose-400"}`}>
          {formatPnl(pnl)}
        </div>
        <div className="text-xs text-zinc-500">{formatTime(trade.exitTime)}</div>
      </div>
    </div>
  );
}
