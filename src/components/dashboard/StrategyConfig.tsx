import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "./StatusBadge";
import { Save, RotateCcw } from "lucide-react";

interface StrategyParams {
  breakoutPeriod: number;
  atrPeriod: number;
  atrStopMultiplier: number;
  atrTargetMultiplier: number;
  rsiPeriod: number;
  rsiLowerThreshold: number;
  rsiUpperThreshold: number;
  emaShort: number;
  emaMedium: number;
  emaLong: number;
  volumeMultiplier: number;
  riskPerTrade: number;
  maxHoldingPeriod: number;
}

interface StrategyConfigProps {
  strategy: StrategyParams;
  isActive: boolean;
  onSave: (params: Partial<StrategyParams>) => void;
  onReset: () => void;
}

export function StrategyConfig({
  strategy,
  isActive,
  onSave,
  onReset,
}: StrategyConfigProps) {
  const [params, setParams] = useState<StrategyParams>(strategy);
  const [hasChanges, setHasChanges] = useState(false);

  const handleChange = (key: keyof StrategyParams, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      setParams((prev) => ({ ...prev, [key]: numValue }));
      setHasChanges(true);
    }
  };

  const handleSave = () => {
    onSave(params);
    setHasChanges(false);
  };

  return (
    <Card className="bg-[#111118] border-white/[0.05]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-zinc-400">
            Strategy Parameters
          </CardTitle>
          <StatusBadge
            status={isActive ? "active" : "inactive"}
            label={isActive ? "Active" : "Paused"}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Breakout Settings */}
        <div>
          <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
            Breakout
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-zinc-400">Period (N)</Label>
              <Input
                type="number"
                value={params.breakoutPeriod}
                onChange={(e) => handleChange("breakoutPeriod", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Volume Filter</Label>
              <Input
                type="number"
                value={params.volumeMultiplier}
                step="0.1"
                onChange={(e) => handleChange("volumeMultiplier", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
          </div>
        </div>

        {/* RSI Settings */}
        <div>
          <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
            RSI
          </h4>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-zinc-400">Period</Label>
              <Input
                type="number"
                value={params.rsiPeriod}
                onChange={(e) => handleChange("rsiPeriod", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Lower</Label>
              <Input
                type="number"
                value={params.rsiLowerThreshold}
                onChange={(e) => handleChange("rsiLowerThreshold", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Upper</Label>
              <Input
                type="number"
                value={params.rsiUpperThreshold}
                onChange={(e) => handleChange("rsiUpperThreshold", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
          </div>
        </div>

        {/* ATR Settings */}
        <div>
          <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
            ATR / Risk
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-zinc-400">Stop (ATR x)</Label>
              <Input
                type="number"
                value={params.atrStopMultiplier}
                step="0.5"
                onChange={(e) => handleChange("atrStopMultiplier", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Target (ATR x)</Label>
              <Input
                type="number"
                value={params.atrTargetMultiplier}
                step="0.5"
                onChange={(e) => handleChange("atrTargetMultiplier", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Risk Per Trade %</Label>
              <Input
                type="number"
                value={(params.riskPerTrade * 100).toFixed(1)}
                step="0.1"
                onChange={(e) => handleChange("riskPerTrade", (parseFloat(e.target.value) / 100).toString())}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Max Hold (candles)</Label>
              <Input
                type="number"
                value={params.maxHoldingPeriod}
                onChange={(e) => handleChange("maxHoldingPeriod", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
          </div>
        </div>

        {/* EMA Settings */}
        <div>
          <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
            EMAs
          </h4>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-zinc-400">Short (15M)</Label>
              <Input
                type="number"
                value={params.emaShort}
                onChange={(e) => handleChange("emaShort", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Medium (1H)</Label>
              <Input
                type="number"
                value={params.emaMedium}
                onChange={(e) => handleChange("emaMedium", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Long (1H)</Label>
              <Input
                type="number"
                value={params.emaLong}
                onChange={(e) => handleChange("emaLong", e.target.value)}
                className="mt-1 h-8 text-sm bg-white/[0.03] border-white/[0.08]"
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={handleSave}
            disabled={!hasChanges}
            className="flex-1 bg-white/10 hover:bg-white/15 text-white border border-white/[0.08]"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setParams(strategy);
              setHasChanges(false);
            }}
            className="border-white/[0.08] hover:bg-white/[0.03]"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
