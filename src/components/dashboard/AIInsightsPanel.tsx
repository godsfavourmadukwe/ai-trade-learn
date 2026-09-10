import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import { Button } from "@/components/ui/button";
import { 
  Brain, TrendingUp, TrendingDown, Target, Activity, Zap, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus, Dna, Flame, AlertTriangle, Equal
} from "lucide-react";
import type { TradingSignal, LearningMetrics, PatternPerformance, MarketRegime } from "@/lib/ai-engine";

interface AIInsightsPanelProps {
  latestSignal: TradingSignal | null;
  signals: TradingSignal[];
  learningMetrics: LearningMetrics;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onResetLearning: () => void;
  patternWeights: Record<string, number>;
  patternPerformance: PatternPerformance[];
  regime: MarketRegime;
}

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
}

function getConfidenceColor(c: number): string {
  if (c >= 70) return "text-emerald-400";
  if (c >= 50) return "text-amber-400";
  return "text-zinc-400";
}

const REGIME_LABELS: Record<MarketRegime, { label: string; color: string; icon: typeof TrendingUp }> = {
  strong_uptrend: { label: "Strong Uptrend", color: "text-emerald-400", icon: TrendingUp },
  uptrend: { label: "Uptrend", color: "text-emerald-300", icon: TrendingUp },
  ranging: { label: "Ranging", color: "text-zinc-400", icon: Equal },
  downtrend: { label: "Downtrend", color: "text-rose-300", icon: TrendingDown },
  strong_downtrend: { label: "Strong Downtrend", color: "text-rose-400", icon: TrendingDown },
  high_volatility: { label: "High Volatility", color: "text-amber-400", icon: AlertTriangle },
  low_volatility: { label: "Low Volatility", color: "text-zinc-300", icon: Equal },
};

export function AIInsightsPanel({
  latestSignal, signals, learningMetrics, isAnalyzing, onAnalyze,
  onResetLearning, patternPerformance, regime,
}: AIInsightsPanelProps) {
  const recentSignals = signals.slice(0, 5);
  const regimeInfo = REGIME_LABELS[regime] || REGIME_LABELS.ranging;
  const RegimeIcon = regimeInfo.icon;

  return (
    <div className="space-y-4">
      {/* AI Status + Evolution */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-400" />
              AI Analysis Engine
            </CardTitle>
            <StatusBadge status={isAnalyzing ? "warning" : "success"} label={isAnalyzing ? "Analyzing..." : "Active"} />
          </div>
        </CardHeader>
        <CardContent>
          {/* Evolution Score */}
          <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-violet-500/10 to-cyan-500/10 border border-violet-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-violet-400 flex items-center gap-1">
                <Dna className="w-3 h-3" /> Evolution Score
              </span>
              <span className="text-lg font-extrabold text-white">{learningMetrics.evolutionScore}/100</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full transition-all duration-1000" style={{ width: `${learningMetrics.evolutionScore}%` }} />
            </div>
            <p className="text-[10px] text-zinc-500 mt-1">
              AI adjusts pattern weights based on accuracy. Higher = more confident in its predictions.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="text-xs text-zinc-500 mb-1">Accuracy</div>
              <div className={`text-xl font-bold ${getConfidenceColor(learningMetrics.accuracy * 100)}`}>
                {(learningMetrics.accuracy * 100).toFixed(1)}%
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="text-xs text-zinc-500 mb-1">Self-Adjustments</div>
              <div className="text-xl font-bold text-amber-400">{learningMetrics.selfAdjustments}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
              <div className="text-lg font-bold text-emerald-400">{learningMetrics.signalsWinning}</div>
              <div className="text-[10px] text-zinc-500">Wins</div>
            </div>
            <div className="p-2 rounded-lg bg-rose-500/5 border border-rose-500/10">
              <div className="text-lg font-bold text-rose-400">{learningMetrics.signalsLosing}</div>
              <div className="text-[10px] text-zinc-500">Losses</div>
            </div>
            <div className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
              <div className="text-lg font-bold text-amber-400">{learningMetrics.signalsPending}</div>
              <div className="text-[10px] text-zinc-500">Tracking</div>
            </div>
          </div>

          {/* Current Streak */}
          {learningMetrics.currentStreak > 0 && (
            <div className={`mb-4 p-2 rounded-lg flex items-center gap-2 text-sm ${
              learningMetrics.streakType === "win" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
            }`}>
              <Flame className="w-4 h-4" />
              <span className="font-bold">{learningMetrics.currentStreak} streak</span>
              <span className="text-xs opacity-70">{learningMetrics.streakType === "win" ? "consecutive wins" : "consecutive losses"}</span>
            </div>
          )}

          {/* Regime */}
          <div className="mb-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Current Regime</span>
              <div className="flex items-center gap-2">
                <RegimeIcon className={`w-4 h-4 ${regimeInfo.color}`} />
                <span className={`text-sm font-bold ${regimeInfo.color}`}>{regimeInfo.label}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onAnalyze} disabled={isAnalyzing}
              className="flex-1 border-violet-500/30 text-violet-400 hover:bg-violet-500/10">
              <RefreshCw className={`w-4 h-4 mr-2 ${isAnalyzing ? "animate-spin" : ""}`} /> Analyze Now
            </Button>
            <Button variant="outline" size="sm" onClick={onResetLearning}
              className="border-white/[0.08] hover:bg-white/[0.05]">Reset</Button>
          </div>
        </CardContent>
      </Card>

      {/* Latest Signal */}
      {latestSignal && (
        <Card className={`bg-[#111118] border-[0.08] ${
          latestSignal.action === "buy" ? "border-emerald-500/30" :
          latestSignal.action === "sell" ? "border-rose-500/30" : "border-white/[0.08]"
        }`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" /> Latest Signal
              </CardTitle>
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
                latestSignal.action === "buy" ? "bg-emerald-500/20 text-emerald-400" :
                latestSignal.action === "sell" ? "bg-rose-500/20 text-rose-400" :
                "bg-zinc-500/20 text-zinc-400"
              }`}>
                {latestSignal.action === "buy" ? <ArrowUpRight className="w-4 h-4" /> :
                 latestSignal.action === "sell" ? <ArrowDownRight className="w-4 h-4" /> :
                 <Minus className="w-4 h-4" />}
                <span className="text-sm font-bold uppercase">{latestSignal.action}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-extrabold text-white">{formatPrice(latestSignal.entryPrice)}</span>
                <span className={`text-lg font-bold ${getConfidenceColor(latestSignal.confidence)}`}>{latestSignal.confidence.toFixed(1)}%</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-zinc-500">Stop Loss</span>
                  <div className="font-medium text-rose-400">{formatPrice(latestSignal.stopLoss)}</div>
                </div>
                <div>
                  <span className="text-zinc-500">Take Profit</span>
                  <div className="font-medium text-emerald-400">{formatPrice(latestSignal.takeProfit)}</div>
                </div>
                <div>
                  <span className="text-zinc-500">R:R Ratio</span>
                  <div className="font-medium text-white">{latestSignal.riskReward.toFixed(2)}</div>
                </div>
              </div>
              <div>
                <span className="text-xs text-zinc-500 mb-2 block">AI Reasons</span>
                <div className="space-y-1">
                  {latestSignal.reasons.slice(0, 3).map((reason: string, i: number) => (
                    <div key={i} className="text-xs text-zinc-400 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />{reason}
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-xs text-zinc-500">Expected: {latestSignal.expectedDuration}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pattern Performance (Self-Learning) */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Dna className="w-4 h-4 text-cyan-400" />
            Pattern Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {patternPerformance.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {patternPerformance.slice(0, 8).map((p) => (
                <div key={p.pattern} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-zinc-300 truncate">{p.pattern}</span>
                    <span className={`text-xs font-bold ml-2 ${p.recentAccuracy > 0.6 ? "text-emerald-400" : p.recentAccuracy < 0.4 ? "text-rose-400" : "text-zinc-400"}`}>
                      {(p.recentAccuracy * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                    <span>Weight: {p.weight.toFixed(2)}</span>
                    <span>n={p.total}</span>
                    <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${p.recentAccuracy > 0.6 ? "bg-emerald-500" : p.recentAccuracy < 0.4 ? "bg-rose-500" : "bg-zinc-500"}`}
                        style={{ width: `${p.recentAccuracy * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-sm text-zinc-500">
              <Dna className="w-6 h-6 mx-auto mb-2 text-zinc-600" />
              AI is observing the market. Patterns will appear after it generates and tracks signals.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Signals */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Target className="w-4 h-4 text-amber-400" /> Recent Signals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentSignals.length > 0 ? (
            <div className="space-y-2">
              {recentSignals.map((signal) => (
                <div key={signal.id} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.05] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${signal.action === "buy" ? "bg-emerald-500" : signal.action === "sell" ? "bg-rose-500" : "bg-zinc-500"}`} />
                    <span className="text-xs text-zinc-400">{signal.symbol}</span>
                    <span className={`text-xs font-bold ${signal.action === "buy" ? "text-emerald-400" : signal.action === "sell" ? "text-rose-400" : "text-zinc-400"}`}>
                      {signal.action.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500">{formatPrice(signal.entryPrice)}</span>
                    <span className={`text-xs font-bold ${getConfidenceColor(signal.confidence)}`}>{signal.confidence.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-sm text-zinc-500">No signals yet. Start analyzing markets.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
