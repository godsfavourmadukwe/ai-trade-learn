import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import type { TradingSignal } from "@/lib/ai-engine";

function formatTimestamp(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPrice(price: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(price);
}

export function SignalList({ signals }: { signals: TradingSignal[] }) {
  return (
    <Card className="bg-[#111118] border-white/[0.05]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-zinc-400">
            Recent Signals
          </CardTitle>
          <StatusBadge status="active" label="Live" />
        </div>
      </CardHeader>
      <CardContent>
        {signals.length > 0 ? (
          <div className="space-y-3">
            {signals.map((signal) => (
              <div
                key={signal.id}
                className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.08] transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        signal.action === "buy"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : signal.action === "sell"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-zinc-500/10 text-zinc-400"
                      }`}
                    >
                      {signal.action === "buy" ? "LONG" : signal.action === "sell" ? "SHORT" : "HOLD"}
                    </span>
                    <span className="text-sm text-white font-medium">
                      {formatPrice(signal.entryPrice)}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500">
                    {formatTimestamp(signal.timestamp)}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-zinc-500">RSI</span>
                    <span className="ml-1 text-zinc-300">{signal.indicators.rsi.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">ATR</span>
                    <span className="ml-1 text-zinc-300">{signal.indicators.atr.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">EMA50</span>
                    <span className="ml-1 text-zinc-300">{signal.indicators.ema50.toFixed(0)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Regime</span>
                    <span className="ml-1 text-zinc-300 capitalize">{signal.regime.replace(/_/g, " ")}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-zinc-500">
            No signals yet. Start analyzing markets.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
