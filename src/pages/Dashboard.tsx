import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { PerformanceChart } from "@/components/dashboard/PerformanceChart";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { SignalList } from "@/components/dashboard/SignalList";
import { StrategyConfig } from "@/components/dashboard/StrategyConfig";
import { RiskPanel } from "@/components/dashboard/RiskPanel";
import { 
  LogOut, 
  TrendingUp, 
  BarChart3, 
  Brain, 
  Shield, 
  Activity,
  Target,
  Zap,
  RefreshCw,
  Play,
  Pause,
  Settings
} from "lucide-react";

// Demo data for visualization
const generateDemoData = () => {
  const data: number[] = [];
  let value = 10000;
  for (let i = 0; i < 30; i++) {
    value += (Math.random() - 0.45) * 500;
    data.push(value);
  }
  return data;
};

const demoSignals = [
  {
    id: "1",
    timestamp: Date.now() - 1000 * 60 * 15,
    type: "long_entry",
    price: 67450.25,
    regime: "trending",
    indicators: { rsi: 62.5, atr: 425.30, ema50: 67200, ema200: 65800 },
  },
  {
    id: "2",
    timestamp: Date.now() - 1000 * 60 * 60 * 2,
    type: "long_entry",
    price: 66890.00,
    regime: "trending",
    indicators: { rsi: 58.2, atr: 398.15, ema50: 67000, ema200: 65500 },
  },
  {
    id: "3",
    timestamp: Date.now() - 1000 * 60 * 60 * 5,
    type: "long_entry",
    price: 66340.50,
    regime: "high_volatility",
    indicators: { rsi: 68.9, atr: 512.80, ema50: 66800, ema200: 65200 },
  },
];

const defaultStrategy = {
  breakoutPeriod: 20,
  atrPeriod: 14,
  atrStopMultiplier: 2,
  atrTargetMultiplier: 4,
  rsiPeriod: 14,
  rsiLowerThreshold: 55,
  rsiUpperThreshold: 75,
  emaShort: 20,
  emaMedium: 50,
  emaLong: 200,
  volumeMultiplier: 1.2,
  riskPerTrade: 0.005,
  maxHoldingPeriod: 48,
};

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [equityData, setEquityData] = useState<number[]>([]);
  const [drawdownData, setDrawdownData] = useState<number[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    setEquityData(generateDemoData());
    setDrawdownData(generateDemoData().map((v) => Math.min(0, (v - 10000) / 100)));
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleSaveStrategy = (params: Partial<typeof defaultStrategy>) => {
    console.log("Saving strategy params:", params);
    // In production, this would save to Convex
  };

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-white/[0.05] sticky top-0 z-50 bg-[#0a0a0f]/80 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold tracking-tight">QuantumFlow</h1>
                  <p className="text-xs text-zinc-500">AI Trading Bot</p>
                </div>
              </div>
              <div className="hidden md:flex items-center gap-2">
                <StatusBadge status={isRunning ? "active" : "inactive"} label={isRunning ? "Running" : "Paused"} />
                <StatusBadge status="success" label="BTC/USDT" />
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm text-zinc-400">Welcome back</p>
                <p className="text-sm font-medium">{user?.name || "Trader"}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsRunning(!isRunning)}
                className={isRunning ? "border-red-500/30 text-red-400 hover:bg-red-500/10" : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"}
              >
                {isRunning ? (
                  <>
                    <Pause className="w-4 h-4 mr-2" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Start
                  </>
                )}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleSignOut}>
                <LogOut className="w-4 h-4 text-zinc-400" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white/[0.03] border border-white/[0.05] p-1">
            <TabsTrigger value="overview" className="data-[state=active]:bg-white/10">
              <BarChart3 className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="strategy" className="data-[state=active]:bg-white/10">
              <Target className="w-4 h-4 mr-2" />
              Strategy
            </TabsTrigger>
            <TabsTrigger value="signals" className="data-[state=active]:bg-white/10">
              <Zap className="w-4 h-4 mr-2" />
              Signals
            </TabsTrigger>
            <TabsTrigger value="risk" className="data-[state=active]:bg-white/10">
              <Shield className="w-4 h-4 mr-2" />
              Risk
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Top Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Portfolio Value"
                value="$10,245.30"
                trend="up"
                trendValue="+2.45%"
                icon={TrendingUp}
              />
              <MetricCard
                label="Open P&L"
                value="+$145.20"
                subtitle="1 position"
                trend="up"
                trendValue="+1.45%"
                icon={BarChart3}
              />
              <MetricCard
                label="Win Rate"
                value="62.5%"
                subtitle="20 trades"
                trend="up"
                trendValue="+5.2%"
                icon={Target}
              />
              <MetricCard
                label="Sharpe Ratio"
                value="1.85"
                subtitle="Annualized"
                trend="neutral"
                trendValue="Stable"
                icon={Brain}
              />
            </div>

            {/* Charts */}
            <div className="grid md:grid-cols-2 gap-4">
              <PerformanceChart
                title="Equity Curve"
                data={equityData}
                color="green"
              />
              <PerformanceChart
                title="Drawdown"
                data={drawdownData}
                color="red"
              />
            </div>

            {/* Recent Activity */}
            <div className="grid lg:grid-cols-3 gap-4">
              <SignalList signals={demoSignals} />
              
              <Card className="bg-[#111118] border-white/[0.05]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-zinc-400">
                    Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    variant="outline"
                    className="w-full justify-start border-white/[0.08] hover:bg-white/[0.03]"
                  >
                    <Play className="w-4 h-4 mr-3" />
                    Start Paper Trading
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start border-white/[0.08] hover:bg-white/[0.03]"
                  >
                    <BarChart3 className="w-4 h-4 mr-3" />
                    Run Backtest
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start border-white/[0.08] hover:bg-white/[0.03]"
                  >
                    <Settings className="w-4 h-4 mr-3" />
                    Configure Strategy
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start border-white/[0.08] hover:bg-white/[0.03]"
                  >
                    <RefreshCw className="w-4 h-4 mr-3" />
                    Refresh Data
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-[#111118] border-white/[0.05]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-zinc-400">
                    Market Regime
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">Current</span>
                      <StatusBadge status="success" label="Trending" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">Volatility</span>
                      <StatusBadge status="active" label="Normal" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">1H Trend</span>
                      <StatusBadge status="success" label="Bullish" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">Breakout</span>
                      <StatusBadge status="success" label="Active" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Strategy Tab */}
          <TabsContent value="strategy" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <StrategyConfig
                strategy={defaultStrategy}
                isActive={isRunning}
                onSave={handleSaveStrategy}
                onReset={() => console.log("Reset to defaults")}
              />
              
              <Card className="bg-[#111118] border-white/[0.05]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-zinc-400">
                    Entry Conditions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[
                      { label: "1H EMA50 > EMA200", met: true },
                      { label: "1H Close > EMA50", met: true },
                      { label: "15M Breakout (N=20)", met: true },
                      { label: "RSI 14: 55 < RSI < 75", met: true },
                      { label: "Volume > 1.2x MA", met: true },
                      { label: "No Existing Position", met: true },
                      { label: "Risk Limits OK", met: true },
                      { label: "Data Fresh", met: true },
                    ].map((condition) => (
                      <div
                        key={condition.label}
                        className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0"
                      >
                        <span className="text-sm text-zinc-300">{condition.label}</span>
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center ${
                            condition.met
                              ? "bg-emerald-500/20"
                              : "bg-zinc-500/20"
                          }`}
                        >
                          <div
                            className={`w-2 h-2 rounded-full ${
                              condition.met ? "bg-emerald-500" : "bg-zinc-500"
                            }`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-[#111118] border-white/[0.05]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-zinc-400">
                  Strategy Hypothesis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-300 leading-relaxed mb-4">
                  <span className="text-blue-400 font-medium">Hypothesis:</span>{" "}
                  "Liquid cryptocurrency markets can exhibit short- to medium-term directional momentum 
                  after a sufficiently strong breakout from a period of consolidation, particularly when 
                  the higher timeframe agrees with the breakout direction and volatility is expanding."
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Trend", desc: "Higher TF alignment" },
                    { label: "Breakout", desc: "Donchian N=20" },
                    { label: "Momentum", desc: "RSI 55-75" },
                    { label: "Volatility", desc: "ATR expansion" },
                  ].map((element) => (
                    <div
                      key={element.label}
                      className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05] text-center"
                    >
                      <div className="text-sm font-medium text-white mb-1">{element.label}</div>
                      <div className="text-xs text-zinc-500">{element.desc}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Signals Tab */}
          <TabsContent value="signals" className="space-y-6">
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <SignalList signals={demoSignals} />
              </div>
              <div className="space-y-4">
                <Card className="bg-[#111118] border-white/[0.05]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-zinc-400">
                      Signal Statistics
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {[
                        { label: "Total Signals", value: "47" },
                        { label: "Long Entries", value: "32" },
                        { label: "Exits", value: "28" },
                        { label: "Rejected", value: "15" },
                        { label: "Win Rate", value: "62.5%" },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0"
                        >
                          <span className="text-sm text-zinc-400">{stat.label}</span>
                          <span className="text-sm font-medium text-white">{stat.value}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-[#111118] border-white/[0.05]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-zinc-400">
                      Regime Performance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[
                        { regime: "Trending", trades: 18, winRate: "72%", expectancy: "+$45.20" },
                        { regime: "Ranging", trades: 8, winRate: "50%", expectancy: "+$12.40" },
                        { regime: "High Vol", trades: 12, winRate: "58%", expectancy: "+$28.90" },
                      ].map((data) => (
                        <div
                          key={data.regime}
                          className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-white">{data.regime}</span>
                            <span className="text-xs text-zinc-500">{data.trades} trades</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-zinc-500">Win Rate</span>
                              <span className="ml-2 text-zinc-300">{data.winRate}</span>
                            </div>
                            <div>
                              <span className="text-zinc-500">Expectancy</span>
                              <span className="ml-2 text-emerald-400">{data.expectancy}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Risk Tab */}
          <TabsContent value="risk" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <RiskPanel
                limits={{
                  dailyLossLimit: 200,
                  weeklyLossLimit: 500,
                  maxDrawdown: 0.15,
                  maxConsecutiveLosses: 5,
                  currentDailyPnL: 45.20,
                  currentWeeklyPnL: 125.80,
                  currentDrawdown: 0.028,
                  consecutiveLosses: 2,
                }}
                isEmergencyStop={false}
              />
              
              <Card className="bg-[#111118] border-white/[0.05]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-zinc-400">
                    Position Risk
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-emerald-400">Open Position</span>
                        <StatusBadge status="active" label="BTC/USDT Long" />
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-zinc-500">Entry</span>
                          <span className="ml-2 text-white">$67,450.25</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Current</span>
                          <span className="ml-2 text-emerald-400">$67,595.45</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Stop</span>
                          <span className="ml-2 text-red-400">$66,599.65</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Target</span>
                          <span className="ml-2 text-emerald-400">$68,300.85</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Size</span>
                          <span className="ml-2 text-white">0.00074 BTC</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Risk</span>
                          <span className="ml-2 text-amber-400">$5.00 (0.5%)</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-zinc-300">Risk Summary</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-zinc-500">Portfolio Risk</span>
                          <span className="ml-2 text-white">0.5%</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Max Positions</span>
                          <span className="ml-2 text-white">1 / 1</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Daily Used</span>
                          <span className="ml-2 text-amber-400">22.6%</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Weekly Used</span>
                          <span className="ml-2 text-emerald-400">25.2%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-[#111118] border-white/[0.05]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-zinc-400">
                  No-Trade Conditions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { condition: "Higher TF trend not aligned", active: false },
                    { condition: "RSI confirmation fails", active: false },
                    { condition: "No breakout occurred", active: false },
                    { condition: "Spread excessive", active: false },
                    { condition: "Liquidity insufficient", active: false },
                    { condition: "Volatility extreme", active: false },
                    { condition: "Daily loss limit hit", active: false },
                    { condition: "Max drawdown active", active: false },
                    { condition: "API state unreliable", active: false },
                    { condition: "Market data stale", active: false },
                    { condition: "Position limit reached", active: false },
                    { condition: "System error", active: false },
                  ].map((item) => (
                    <div
                      key={item.condition}
                      className={`p-3 rounded-lg border ${
                        item.active
                          ? "bg-red-500/5 border-red-500/20"
                          : "bg-white/[0.02] border-white/[0.05]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            item.active ? "bg-red-500" : "bg-emerald-500"
                          }`}
                        />
                        <span className="text-xs text-zinc-300">{item.condition}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
