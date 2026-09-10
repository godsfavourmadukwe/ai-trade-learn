import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
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
  Settings,
  Search,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Globe,
  Star,
  Sparkles
} from "lucide-react";

// Demo currency pairs with more data
const currencyPairs = [
  { symbol: "BTC/USDT", name: "Bitcoin", price: 67450.25, change24h: 2.45, volume: "28.5B", marketCap: "1.32T", trend: "bullish" as const },
  { symbol: "ETH/USDT", name: "Ethereum", price: 3542.80, change24h: 3.12, volume: "15.2B", marketCap: "425B", trend: "bullish" as const },
  { symbol: "SOL/USDT", name: "Solana", price: 148.65, change24h: -1.23, volume: "3.8B", marketCap: "65.4B", trend: "bearish" as const },
  { symbol: "BNB/USDT", name: "BNB", price: 584.30, change24h: 0.89, volume: "2.1B", marketCap: "89.2B", trend: "bullish" as const },
  { symbol: "XRP/USDT", name: "XRP", price: 0.5234, change24h: 1.56, volume: "1.9B", marketCap: "28.5B", trend: "bullish" as const },
  { symbol: "ADA/USDT", name: "Cardano", price: 0.4521, change24h: -0.67, volume: "0.8B", marketCap: "15.9B", trend: "bearish" as const },
  { symbol: "DOGE/USDT", name: "Dogecoin", price: 0.1234, change24h: 4.56, volume: "1.2B", marketCap: "17.6B", trend: "bullish" as const },
  { symbol: "AVAX/USDT", name: "Avalanche", price: 35.42, change24h: 2.89, volume: "0.9B", marketCap: "13.2B", trend: "bullish" as const },
  { symbol: "DOT/USDT", name: "Polkadot", price: 7.89, change24h: -0.34, volume: "0.5B", marketCap: "10.5B", trend: "neutral" as const },
  { symbol: "LINK/USDT", name: "Chainlink", price: 14.56, change24h: 1.23, volume: "0.7B", marketCap: "8.6B", trend: "bullish" as const },
];

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
    price: 3542.80,
    regime: "trending",
    indicators: { rsi: 58.2, atr: 85.40, ema50: 3480, ema200: 3250 },
  },
  {
    id: "3",
    timestamp: Date.now() - 1000 * 60 * 60 * 5,
    type: "long_entry",
    price: 148.65,
    regime: "high_volatility",
    indicators: { rsi: 68.9, atr: 12.80, ema50: 145, ema200: 132 },
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
  const [activeTab, setActiveTab] = useState("markets");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPair, setSelectedPair] = useState(currencyPairs[0]);

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
  };

  const filteredPairs = currencyPairs.filter(
    (pair) =>
      pair.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pair.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatPrice = (price: number) => {
    if (price < 1) return `$${price.toFixed(4)}`;
    if (price < 100) return `$${price.toFixed(2)}`;
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0a0a12] via-[#0d0d1a] to-[#0a0a12] text-white">
      {/* Header */}
      <header className="border-b border-white/10 sticky top-0 z-50 bg-[#0a0a12]/80 backdrop-blur-xl">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 via-cyan-500 to-amber-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-violet-400 via-cyan-400 to-amber-400 bg-clip-text text-transparent">
                    TRADSLY
                  </h1>
                  <p className="text-xs text-zinc-500">AI Trading Intelligence</p>
                </div>
              </div>
              <div className="hidden md:flex items-center gap-3">
                <StatusBadge status={isRunning ? "active" : "inactive"} label={isRunning ? "Bot Active" : "Bot Paused"} />
                <StatusBadge status="success" label={selectedPair.symbol} />
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm text-zinc-400">Welcome back</p>
                <p className="text-sm font-bold">{user?.name || "Trader"}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsRunning(!isRunning)}
                className={`${isRunning 
                  ? "border-red-500/50 text-red-400 hover:bg-red-500/20 bg-red-500/10" 
                  : "border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20 bg-emerald-500/10"} font-semibold`}
              >
                {isRunning ? (
                  <>
                    <Pause className="w-4 h-4 mr-2" />
                    Stop Bot
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Start Bot
                  </>
                )}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleSignOut} className="text-zinc-400 hover:text-white">
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1800px] mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white/[0.03] border border-white/10 p-1.5 rounded-xl">
            <TabsTrigger value="markets" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500/30 data-[state=active]:to-cyan-500/30 data-[state=active]:text-white font-semibold">
              <Globe className="w-4 h-4 mr-2" />
              Markets
            </TabsTrigger>
            <TabsTrigger value="overview" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/30 data-[state=active]:to-blue-500/30 data-[state=active]:text-white font-semibold">
              <BarChart3 className="w-4 h-4 mr-2" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="strategy" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500/30 data-[state=active]:to-indigo-500/30 data-[state=active]:text-white font-semibold">
              <Target className="w-4 h-4 mr-2" />
              Strategy
            </TabsTrigger>
            <TabsTrigger value="signals" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500/30 data-[state=active]:to-orange-500/30 data-[state=active]:text-white font-semibold">
              <Sparkles className="w-4 h-4 mr-2" />
              AI Signals
            </TabsTrigger>
            <TabsTrigger value="risk" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500/30 data-[state=active]:to-teal-500/30 data-[state=active]:text-white font-semibold">
              <Shield className="w-4 h-4 mr-2" />
              Risk
            </TabsTrigger>
          </TabsList>

          {/* Markets Tab - Currency Pair Catalog */}
          <TabsContent value="markets" className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-extrabold text-white">Browse Markets</h2>
                <p className="text-zinc-400">Select currency pairs to analyze and trade</p>
              </div>
              <div className="relative w-full md:w-96">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <Input
                  placeholder="Search pairs (e.g., BTC, ETH)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-white/[0.03] border-white/10 h-12 text-white placeholder:text-zinc-500 focus:border-violet-500/50 focus:ring-violet-500/20"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredPairs.map((pair) => (
                <Card
                  key={pair.symbol}
                  className={`bg-[#111118] border-white/[0.08] hover:border-white/[0.2] transition-all cursor-pointer group ${
                    selectedPair.symbol === pair.symbol ? "border-violet-500/50 shadow-lg shadow-violet-500/10" : ""
                  }`}
                  onClick={() => setSelectedPair(pair)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white group-hover:text-violet-400 transition-colors">
                          {pair.symbol}
                        </h3>
                        <p className="text-sm text-zinc-500">{pair.name}</p>
                      </div>
                      <div className={`p-2 rounded-xl ${
                        pair.change24h >= 0 
                          ? "bg-emerald-500/10" 
                          : "bg-rose-500/10"
                      }`}>
                        {pair.change24h >= 0 ? (
                          <ArrowUpRight className={`w-5 h-5 ${pair.change24h >= 0 ? "text-emerald-400" : "text-rose-400"}`} />
                        ) : (
                          <ArrowDownRight className="w-5 h-5 text-rose-400" />
                        )}
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-500">Price</span>
                        <span className="text-lg font-bold text-white">{formatPrice(pair.price)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-500">24h Change</span>
                        <span className={`text-sm font-bold ${
                          pair.change24h >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}>
                          {pair.change24h >= 0 ? "+" : ""}{pair.change24h}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-500">Volume</span>
                        <span className="text-sm font-medium text-zinc-300">{pair.volume}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-500">Market Cap</span>
                        <span className="text-sm font-medium text-zinc-300">{pair.marketCap}</span>
                      </div>
                    </div>
                    
                    <div className="mt-4 pt-4 border-t border-white/[0.05] flex items-center justify-between">
                      <StatusBadge 
                        status={pair.trend === "bullish" ? "success" : pair.trend === "bearish" ? "error" : "inactive"} 
                        label={pair.trend.charAt(0).toUpperCase() + pair.trend.slice(1)} 
                      />
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                      >
                        Analyze
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Overview Tab - Dashboard */}
          <TabsContent value="overview" className="space-y-6">
            {/* Top Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Portfolio Value"
                value="$10,245.30"
                trend="up"
                trendValue="+2.45%"
                icon={TrendingUp}
                className="border-emerald-500/20 hover:border-emerald-500/30"
              />
              <MetricCard
                label="Open P&L"
                value="+$145.20"
                subtitle="1 position"
                trend="up"
                trendValue="+1.45%"
                icon={BarChart3}
                className="border-emerald-500/20 hover:border-emerald-500/30"
              />
              <MetricCard
                label="Win Rate"
                value="62.5%"
                subtitle="20 trades"
                trend="up"
                trendValue="+5.2%"
                icon={Target}
                className="border-violet-500/20 hover:border-violet-500/30"
              />
              <MetricCard
                label="AI Confidence"
                value="78%"
                subtitle="Pattern match"
                trend="up"
                trendValue="High"
                icon={Brain}
                className="border-cyan-500/20 hover:border-cyan-500/30"
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

            {/* Quick Stats */}
            <div className="grid lg:grid-cols-4 gap-4">
              <Card className="bg-[#111118] border-white/[0.08] col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-violet-400" />
                    Active Positions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-white">{selectedPair.symbol}</span>
                        <StatusBadge status="success" label="Long" />
                      </div>
                      <span className="text-emerald-400 font-bold">+$145.20</span>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-zinc-500">Entry</span>
                        <div className="font-medium text-white">{formatPrice(selectedPair.price - 200)}</div>
                      </div>
                      <div>
                        <span className="text-zinc-500">Current</span>
                        <div className="font-medium text-emerald-400">{formatPrice(selectedPair.price)}</div>
                      </div>
                      <div>
                        <span className="text-zinc-500">Stop</span>
                        <div className="font-medium text-rose-400">{formatPrice(selectedPair.price - 850)}</div>
                      </div>
                      <div>
                        <span className="text-zinc-500">Target</span>
                        <div className="font-medium text-emerald-400">{formatPrice(selectedPair.price + 1700)}</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[#111118] border-white/[0.08]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    AI Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">Market Regime</span>
                      <StatusBadge status="success" label="Trending" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">Pattern</span>
                      <span className="text-sm font-bold text-emerald-400">Breakout</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">Confidence</span>
                      <span className="text-sm font-bold text-violet-400">78%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[#111118] border-white/[0.08]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-400" />
                    Watchlist
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {currencyPairs.slice(0, 4).map((pair) => (
                      <div key={pair.symbol} className="flex items-center justify-between py-1">
                        <span className="text-sm text-zinc-300">{pair.symbol}</span>
                        <span className={`text-xs font-bold ${
                          pair.change24h >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}>
                          {pair.change24h >= 0 ? "+" : ""}{pair.change24h}%
                        </span>
                      </div>
                    ))}
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
              
              <Card className="bg-[#111118] border-white/[0.08]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                    <Target className="w-4 h-4 text-cyan-400" />
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

            <Card className="bg-[#111118] border-white/[0.08]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                  <Brain className="w-4 h-4 text-violet-400" />
                  AI Learning Hypothesis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-300 leading-relaxed mb-6">
                  <span className="text-violet-400 font-bold">Core Hypothesis:</span>{" "}
                  "Liquid cryptocurrency markets exhibit short- to medium-term directional momentum 
                  after strong breakouts from consolidation, particularly when the higher timeframe 
                  confirms the breakout direction and volatility is expanding."
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Trend", desc: "Higher TF alignment", color: "from-violet-500 to-purple-600" },
                    { label: "Breakout", desc: "Donchian N=20", color: "from-cyan-500 to-blue-600" },
                    { label: "Momentum", desc: "RSI 55-75", color: "from-amber-500 to-orange-600" },
                    { label: "Volatility", desc: "ATR expansion", color: "from-emerald-500 to-teal-600" },
                  ].map((element) => (
                    <div
                      key={element.label}
                      className={`p-4 rounded-xl bg-gradient-to-br ${element.color} bg-opacity-10 border border-white/[0.08] text-center`}
                    >
                      <div className="text-sm font-bold text-white mb-1">{element.label}</div>
                      <div className="text-xs text-zinc-400">{element.desc}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* AI Signals Tab */}
          <TabsContent value="signals" className="space-y-6">
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <SignalList signals={demoSignals} />
              </div>
              <div className="space-y-4">
                <Card className="bg-[#111118] border-white/[0.08]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      AI Signal Stats
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {[
                        { label: "Total Signals", value: "47", color: "text-white" },
                        { label: "Buy Signals", value: "32", color: "text-emerald-400" },
                        { label: "Sell Signals", value: "15", color: "text-rose-400" },
                        { label: "Win Rate", value: "62.5%", color: "text-violet-400" },
                        { label: "Avg Confidence", value: "78%", color: "text-cyan-400" },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0"
                        >
                          <span className="text-sm text-zinc-400">{stat.label}</span>
                          <span className={`text-sm font-bold ${stat.color}`}>{stat.value}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-[#111118] border-white/[0.08]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-emerald-400" />
                      Pattern Performance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[
                        { regime: "Trending", trades: 18, winRate: "72%", expectancy: "+$45.20", color: "emerald" },
                        { regime: "Breakout", trades: 12, winRate: "65%", expectancy: "+$38.90", color: "cyan" },
                        { regime: "Momentum", trades: 17, winRate: "58%", expectancy: "+$28.40", color: "violet" },
                      ].map((data) => (
                        <div
                          key={data.regime}
                          className={`p-3 rounded-xl bg-${data.color}-500/5 border border-${data.color}-500/20`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-bold text-white">{data.regime}</span>
                            <span className="text-xs text-zinc-500">{data.trades} signals</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-zinc-500">Win Rate</span>
                              <span className="ml-2 font-bold text-white">{data.winRate}</span>
                            </div>
                            <div>
                              <span className="text-zinc-500">Expectancy</span>
                              <span className="ml-2 font-bold text-emerald-400">{data.expectancy}</span>
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
              
              <Card className="bg-[#111118] border-white/[0.08]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    Portfolio Risk Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-bold text-emerald-400">All Systems Normal</span>
                        <StatusBadge status="success" label="Operational" />
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-zinc-500">Portfolio Risk</span>
                          <div className="font-bold text-white">0.5%</div>
                        </div>
                        <div>
                          <span className="text-zinc-500">Max Positions</span>
                          <div className="font-bold text-white">1 / 1</div>
                        </div>
                        <div>
                          <span className="text-zinc-500">Daily Limit Used</span>
                          <div className="font-bold text-amber-400">22.6%</div>
                        </div>
                        <div>
                          <span className="text-zinc-500">Weekly Limit Used</span>
                          <div className="font-bold text-emerald-400">25.2%</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-[#111118] border-white/[0.08]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-cyan-400" />
                  Safety Checkpoints
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { condition: "Higher TF trend aligned", active: false },
                    { condition: "RSI confirmation passed", active: false },
                    { condition: "Breakout detected", active: false },
                    { condition: "Spread within limits", active: false },
                    { condition: "Liquidity sufficient", active: false },
                    { condition: "Volatility normal", active: false },
                    { condition: "Daily loss limit OK", active: false },
                    { condition: "Drawdown acceptable", active: false },
                    { condition: "API connection stable", active: false },
                    { condition: "Data feed fresh", active: false },
                    { condition: "Position limits OK", active: false },
                    { condition: "System healthy", active: false },
                  ].map((item) => (
                    <div
                      key={item.condition}
                      className={`p-3 rounded-xl border ${
                        item.active
                          ? "bg-red-500/10 border-red-500/30"
                          : "bg-emerald-500/5 border-emerald-500/20"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2.5 h-2.5 rounded-full ${
                            item.active ? "bg-red-500" : "bg-emerald-500"
                          }`}
                        />
                        <span className="text-sm font-medium text-zinc-300">{item.condition}</span>
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
