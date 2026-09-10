import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import { Shield, AlertTriangle, AlertOctagon } from "lucide-react";

interface RiskLimits {
  dailyLossLimit: number;
  weeklyLossLimit: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  currentDailyPnL: number;
  currentWeeklyPnL: number;
  currentDrawdown: number;
  consecutiveLosses: number;
}

interface RiskPanelProps {
  limits: RiskLimits;
  isEmergencyStop: boolean;
}

export function RiskPanel({ limits, isEmergencyStop }: RiskPanelProps) {
  const getDailyStatus = () => {
    const usage = Math.abs(limits.currentDailyPnL) / limits.dailyLossLimit;
    if (usage >= 1) return "error";
    if (usage >= 0.75) return "warning";
    return "success";
  };

  const getWeeklyStatus = () => {
    const usage = Math.abs(limits.currentWeeklyPnL) / limits.weeklyLossLimit;
    if (usage >= 1) return "error";
    if (usage >= 0.75) return "warning";
    return "success";
  };

  const getDrawdownStatus = () => {
    const usage = limits.currentDrawdown / limits.maxDrawdown;
    if (usage >= 1) return "error";
    if (usage >= 0.75) return "warning";
    return "success";
  };

  const getConsecutiveStatus = () => {
    if (limits.consecutiveLosses >= limits.maxConsecutiveLosses) return "error";
    if (limits.consecutiveLosses >= limits.maxConsecutiveLosses - 2) return "warning";
    return "success";
  };

  return (
    <Card className="bg-[#111118] border-white/[0.05]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-zinc-400 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Risk Management
          </CardTitle>
          <StatusBadge
            status={isEmergencyStop ? "error" : "active"}
            label={isEmergencyStop ? "EMERGENCY STOP" : "Normal"}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Daily Loss */}
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400">Daily Loss</span>
            <StatusBadge
              status={getDailyStatus()}
              label={`${((Math.abs(limits.currentDailyPnL) / limits.dailyLossLimit) * 100).toFixed(0)}%`}
            />
          </div>
          <div className="w-full h-2 bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                getDailyStatus() === "error"
                  ? "bg-red-500"
                  : getDailyStatus() === "warning"
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              }`}
              style={{
                width: `${Math.min(100, (Math.abs(limits.currentDailyPnL) / limits.dailyLossLimit) * 100)}%`,
              }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-zinc-500">
            <span>${Math.abs(limits.currentDailyPnL).toFixed(2)}</span>
            <span>${limits.dailyLossLimit.toFixed(2)}</span>
          </div>
        </div>

        {/* Weekly Loss */}
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400">Weekly Loss</span>
            <StatusBadge
              status={getWeeklyStatus()}
              label={`${((Math.abs(limits.currentWeeklyPnL) / limits.weeklyLossLimit) * 100).toFixed(0)}%`}
            />
          </div>
          <div className="w-full h-2 bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                getWeeklyStatus() === "error"
                  ? "bg-red-500"
                  : getWeeklyStatus() === "warning"
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              }`}
              style={{
                width: `${Math.min(100, (Math.abs(limits.currentWeeklyPnL) / limits.weeklyLossLimit) * 100)}%`,
              }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-zinc-500">
            <span>${Math.abs(limits.currentWeeklyPnL).toFixed(2)}</span>
            <span>${limits.weeklyLossLimit.toFixed(2)}</span>
          </div>
        </div>

        {/* Max Drawdown */}
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400">Drawdown</span>
            <StatusBadge
              status={getDrawdownStatus()}
              label={`${((limits.currentDrawdown / limits.maxDrawdown) * 100).toFixed(0)}%`}
            />
          </div>
          <div className="w-full h-2 bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                getDrawdownStatus() === "error"
                  ? "bg-red-500"
                  : getDrawdownStatus() === "warning"
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              }`}
              style={{
                width: `${Math.min(100, (limits.currentDrawdown / limits.maxDrawdown) * 100)}%`,
              }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-zinc-500">
            <span>{(limits.currentDrawdown * 100).toFixed(1)}%</span>
            <span>{(limits.maxDrawdown * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Consecutive Losses */}
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400">Consecutive Losses</span>
            <StatusBadge
              status={getConsecutiveStatus()}
              label={`${limits.consecutiveLosses} / ${limits.maxConsecutiveLosses}`}
            />
          </div>
          <div className="flex gap-1">
            {Array.from({ length: limits.maxConsecutiveLosses }).map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-2 rounded-sm ${
                  i < limits.consecutiveLosses ? "bg-red-500" : "bg-white/[0.05]"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Warning Messages */}
        {(getDailyStatus() === "error" ||
          getWeeklyStatus() === "error" ||
          getDrawdownStatus() === "error" ||
          getConsecutiveStatus() === "error") && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <AlertOctagon className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="text-xs text-red-300">
              <p className="font-medium mb-1">Trading Suspended</p>
              <p className="text-red-400">
                One or more risk limits have been reached. New positions are blocked until the next session.
              </p>
            </div>
          </div>
        )}

        {getConsecutiveStatus() === "warning" && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-300">
              <p className="font-medium">Approaching Limit</p>
              <p className="text-amber-400">
                Consecutive losses approaching threshold. Diagnostic analysis recommended.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
