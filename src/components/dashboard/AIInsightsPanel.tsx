import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import { Button } from "@/components/ui/button";
import { 
  Brain, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Activity,
  Zap,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Minus
} from "lucide-react";
import type { TradingSignal, LearningMetrics } from "@/lib/ai-engine";

interface AIInsightsPanelProps {
  latestSignal: TradingSignal | null;
  signals: TradingSignal[];
  learningMetrics: LearningMetrics;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onResetLearning: () => void;
  patternWeights: Record<string, number>;
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (price >= 1) {
    return `$${price.toFixed(2)}`;
  } else {
    return `$${price.toFixed(4)}`;
  }
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 70) return "text-emerald-400";
  if (confidence >= 50) return "text-amber-400";
  return "text-zinc-400";
}

function getConfidenceStatus(confidence: number): "success" | "warning" | "inactive" {
  if (confidence >= 70) return "success";
  if (confidence >= 50) return "warning";
  return "inactive";
}

export function AIInsightsPanel({
  latestSignal,
  signals,
  learningMetrics,
  isAnalyzing,
  onAnalyze,
  onResetLearning,
  patternWeights,
}: AIInsightsPanelProps) {
  const recentSignals = signals.slice(0, 5);
  
  // Calculate win/loss from recent signals
  const recentWins = signals.filter(s => s.action === "buy" && s.confidence > 60).length;
  const recentTotal = signals.length;
  
  return (
    <div className="space-y-4">
      {/* AI Status Card */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-400" />
              AI Analysis Engine
            </CardTitle>
            <StatusBadge 
              status={isAnalyzing ? "warning" : "success"} 
              label={isAnalyzing ? "Analyzing..." : "Active"} 
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="text-xs text-zinc-500 mb-1">Accuracy</div>
              <div className={`text-xl font-bold ${getConfidenceColor(learningMetrics.accuracy * 100)}`}>
                {(learningMetrics.accuracy * 100).toFixed(1)}%
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="text-xs text-zinc-500 mb-1">Predictions</div>
              <div className="text-xl font-bold text-white">
                {learningMetrics.totalPredictions}
              </div>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="flex-1 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isAnalyzing ? "animate-spin" : ""}`} />
              Analyze Now
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onResetLearning}
              className="border-white/[0.08] hover:bg-white/[0.05]"
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Latest Signal Card */}
      {latestSignal && (
        <Card className={`bg-[#111118] border-[0.08] ${
          latestSignal.action === "buy" ? "border-emerald-500/30" :
          latestSignal.action === "sell" ? "border-rose-500/30" :
          "border-white/[0.08]"
        }`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Latest Signal
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
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-extrabold text-white">
                  {formatPrice(latestSignal.entryPrice)}
                </span>
                <span className={`text-lg font-bold ${getConfidenceColor(latestSignal.confidence)}`}>
                  {latestSignal.confidence.toFixed(1)}%
                </span>
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
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                      {reason}
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="text-xs text-zinc-500">
                Expected duration: {latestSignal.expectedDuration}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Learning Progress */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            AI Learning Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {learningMetrics.bestPerformingPatterns.length > 0 && (
              <div>
                <span className="text-xs text-emerald-400 font-medium mb-2 block">Best Patterns</span>
                <div className="space-y-1">
                  {learningMetrics.bestPerformingPatterns.slice(0, 2).map((pattern: string, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">{pattern}</span>
                      <TrendingUp className="w-3 h-3 text-emerald-400" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {learningMetrics.worstPerformingPatterns.length > 0 && (
              <div>
                <span className="text-xs text-rose-400 font-medium mb-2 block">Needs Improvement</span>
                <div className="space-y-1">
                  {learningMetrics.worstPerformingPatterns.slice(0, 2).map((pattern: string, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">{pattern}</span>
                      <TrendingDown className="w-3 h-3 text-rose-400" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {learningMetrics.bestPerformingPatterns.length === 0 && (
              <div className="text-center py-4 text-sm text-zinc-500">
                AI is learning... Analyze more signals to see patterns.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Signals */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Target className="w-4 h-4 text-amber-400" />
            Recent Signals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentSignals.length > 0 ? (
            <div className="space-y-2">
              {recentSignals.map((signal) => (
                <div
                  key={signal.id}
                  className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.05] flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      signal.action === "buy" ? "bg-emerald-500" :
                      signal.action === "sell" ? "bg-rose-500" :
                      "bg-zinc-500"
                    }`} />
                    <span className="text-xs text-zinc-400">{signal.symbol}</span>
                    <span className={`text-xs font-bold ${
                      signal.action === "buy" ? "text-emerald-400" :
                      signal.action === "sell" ? "text-rose-400" :
                      "text-zinc-400"
                    }`}>
                      {signal.action.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500">{formatPrice(signal.entryPrice)}</span>
                    <span className={`text-xs font-bold ${getConfidenceColor(signal.confidence)}`}>
                      {signal.confidence.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-sm text-zinc-500">
              No signals yet. Start analyzing markets.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
