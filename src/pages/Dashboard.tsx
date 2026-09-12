import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router";
import { useMarketData } from "@/hooks/use-market-data";
import { usePairSearch } from "@/hooks/use-pair-search";
import { PairSearchPanel } from "@/components/dashboard/PairSearchPanel";
import type { Interval } from "@/lib/market/types";
import { ALL_INTERVALS } from "@/lib/market/types";
import { useAISignals } from "@/hooks/use-ai-signals";
import { useArena } from "@/hooks/use-arena";
import { ArenaPanel } from "@/components/dashboard/ArenaPanel";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { PerformanceChart } from "@/components/dashboard/PerformanceChart";
import { PriceChart } from "@/components/dashboard/PriceChart";
import { CandlestickChart } from "@/components/dashboard/CandlestickChart";
import { LivePriceChart } from "@/components/dashboard/LivePriceChart";
import { AIInsightsPanel } from "@/components/dashboard/AIInsightsPanel";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { SignalList } from "@/components/dashboard/SignalList";
import { StrategyConfig } from "@/components/dashboard/StrategyConfig";
import { RiskPanel } from "@/components/dashboard/RiskPanel";
import { SettingsTab } from "@/components/dashboard/SettingsTab";
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

  Settings,
  Search,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Globe,
  Star,
  Sparkles,
  Clock,
  Swords
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
  const {
    data: marketData,
    loading: marketLoading,
    error: marketError,
    lastFetch,
    refresh: refreshMarket,
    dataSource,
    feedHealth,
    activeProvider,
    candlesFor,
    selectedInterval,
    setInterval: setSelectedInterval,
    tickAgeMs,
  } = useMarketData();  const { 
    signals: aiSignals, 
    latestSignal, 
    isAnalyzing, 
    learningMetrics, 
    patternPerformance,
    regime,
    analyzeSymbol, 
    feedPrice, 
    recordOutcome, 
    getPatternWeights, 
    resetLearning 
  } = useAISignals();
  const {
    trades: arenaTrades,
    signals: arenaSignals,
    performance: arenaPerformance,
    status: arenaStatus,
    isActive: arenaActive,
    start: startArena,
    stop: stopArena,
  } = useArena();
  
  const [equityData, setEquityData] = useState<number[]>([]);
  const [drawdownData, setDrawdownData] = useState<number[]>([]);
  const aiAlwaysRunning = true;
  const [activeTab, setActiveTab] = useState("markets");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPair, setSelectedPair] = useState<string>("BTC/USDT");
  const pairSearch = usePairSearch();
  const aiLastAnalyzedRef = useRef(0);

  useEffect(() => {
    setEquityData(generateDemoData());
    setDrawdownData(generateDemoData().map((v) => Math.min(0, (v - 10000) / 100)));
  }, []);

  // Auto-select first pair when data loads
  useEffect(() => {
    if (marketData.length > 0 && !marketData.find(p => p.symbol === selectedPair)) {
      setSelectedPair(marketData[0].symbol);
    }
  }, [marketData, selectedPair]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleSaveStrategy = (params: Partial<typeof defaultStrategy>) => {
    console.log("Saving strategy params:", params);
  };

  const handleSaveSettings = (config: { bybitApiKey: string; bybitApiSecret: string; binanceApiKey: string; binanceApiSecret: string; openaiApiKey: string }) => {
    console.log("Saving settings:", config);
    // Store in localStorage for demo
    localStorage.setItem("tradslly_api_config", JSON.stringify(config));
  };

  const filteredPairs = marketData.filter(
    (pair) =>
      pair.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pair.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedPairData = marketData.find(p => p.symbol === selectedPair);  // Continuously feed all real-time prices into the AI engine (per snapshot,
  // already batched by the engine — no per-tick React churn)
  useEffect(() => {
    for (const pair of marketData) {
      if (pair.price > 0) {
        feedPrice(pair.symbol, pair.price, pair.volume);
      }
    }
  }, [marketData, feedPrice]);

  // Analyze the selected pair at most every 10s (learning stays continuous,
  // without generating dozens of throwaway signals per minute)
  useEffect(() => {
    if (!selectedPairData || selectedPairData.price <= 0) return;
    const nowMs = Date.now();
    if (nowMs - aiLastAnalyzedRef.current < 10_000) return;
    aiLastAnalyzedRef.current = nowMs;
    analyzeSymbol(selectedPairData.symbol, selectedPairData.price);
  }, [selectedPairData?.price, selectedPairData?.symbol, analyzeSymbol]);

  const formatPrice = (price: number) => {
    if (price < 1) return `$${price.toFixed(4)}`;
    if (price < 100) return `$${price.toFixed(2)}`;
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return "Never";
    const diff = Date.now() - timestamp;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(timestamp).toLocaleTimeString();
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
                <StatusBadge status="active" label="AI Active" />
                <StatusBadge
                  status={feedHealth === "connected" ? "success" : feedHealth === "error" ? "error" : "warning"}
                  label={feedHealth === "connected" ? `Live · ${activeProvider}` : feedHealth === "error" ? "Feed Error" : "Connecting…"}
                />
                {lastFetch && (
                  <span className="text-xs text-zinc-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {tickAgeMs < 2000 ? "Updated just now" : `Feed age ${Math.round(tickAgeMs / 1000)}s`}
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm text-zinc-400">Welcome back</p>
                <p className="text-sm font-bold">{user?.name || "Trader"}</p>
              </div>
              <StatusBadge status="success" label="Always Learning" />
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
            <TabsTrigger value="pairsearch" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-fuchsia-500/30 data-[state=active]:to-violet-500/30 data-[state=active]:text-white font-semibold">
              <Search className="w-4 h-4 mr-2" />
              Pair Search
            </TabsTrigger>
            <TabsTrigger value="arena" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500/30 data-[state=active]:to-red-500/30 data-[state=active]:text-white font-semibold">
              <Swords className="w-4 h-4 mr-2" />
              AI Arena
            </TabsTrigger>
            <TabsTrigger value="risk" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500/30 data-[state=active]:to-teal-500/30 data-[state=active]:text-white font-semibold">
              <Shield className="w-4 h-4 mr-2" />
              Risk
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-zinc-500/30 data-[state=active]:to-zinc-400/30 data-[state=active]:text-white font-semibold">
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Markets Tab - Currency Pair Catalog with Real-Time Data */}
          <TabsContent value="markets" className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-extrabold text-white">Browse Markets</h2>
                <p className="text-zinc-400">Select currency pairs to analyze and trade</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                  <Input
                    placeholder="Search pairs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-white/[0.03] border-white/10 h-12 text-white placeholder:text-zinc-500 focus:border-violet-500/50 focus:ring-violet-500/20"
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={refreshMarket}
                  disabled={marketLoading}
                  className="h-12 w-12 border-white/10 hover:bg-white/[0.05]"
                >
                  <RefreshCw className={`w-5 h-5 ${marketLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {/* Selected Pair Detail with Chart */}
            {selectedPairData && (
              <Card className="bg-[#111118] border-white/[0.08]">
                <CardContent className="p-6">
                  <div className="flex flex-col lg:flex-row gap-6">
                    <div className="lg:w-1/3">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center">
                          <span className="text-lg font-bold text-white">{selectedPairData.symbol.split('/')[0]}</span>
                        </div>
                        <div>
                          <h3 className="text-2xl font-extrabold text-white">{selectedPairData.symbol}</h3>
                          <p className="text-zinc-400">{selectedPairData.name}</p>
                        </div>
                      </div>
                      
                      <div className="text-4xl font-extrabold text-white mb-2">
                        {formatPrice(selectedPairData.price)}
                      </div>
                      
                      <div className={`text-lg font-bold ${
                        selectedPairData.change24hPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}>
                        {selectedPairData.change24hPercent >= 0 ? "+" : ""}{selectedPairData.change24hPercent.toFixed(2)}%
                        <span className="text-sm text-zinc-500 ml-2">(24h)</span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 mt-6 text-sm">
                        <div>
                          <span className="text-zinc-500">24h High</span>
                          <div className="font-bold text-white">{formatPrice(selectedPairData.high24h)}</div>
                        </div>
                        <div>
                          <span className="text-zinc-500">24h Low</span>
                          <div className="font-bold text-white">{formatPrice(selectedPairData.low24h)}</div>
                        </div>
                        <div>
                          <span className="text-zinc-500">Volume</span>
                          <div className="font-bold text-white">${(selectedPairData.volume / 1000000000).toFixed(2)}B</div>
                        </div>
                        <div>
                          <span className="text-zinc-500">Market Cap</span>
                          <div className="font-bold text-white">${(selectedPairData.marketCap / 1000000000).toFixed(2)}B</div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="lg:w-2/3">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-bold text-zinc-300">Live Price Chart</h4>
                        <div className="flex items-center gap-1">
                          {ALL_INTERVALS.map((iv) => (
                            <button
                              key={iv}
                              onClick={() => setSelectedInterval(iv)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                selectedInterval === iv
                                  ? "bg-violet-500/30 text-white border border-violet-400/40"
                                  : "text-zinc-400 hover:text-white hover:bg-white/[0.05] border border-transparent"
                              }`}
                            >
                              {iv.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                      <LivePriceChart
                        candles={candlesFor(selectedPairData.symbol, selectedInterval).map((c) => ({ time: c.time, close: c.close, volume: c.volume }))}
                        symbol={selectedPairData.symbol}
                        currentPrice={selectedPairData.price}
                        height={300}
                        showVolume={true}
                        showLabels={true}
                        showGrid={true}
                        showGradient={true}
                        color="violet"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Pairs Grid */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredPairs.map((pair) => (
                <Card
                  key={pair.symbol}
                  className={`bg-[#111118] border-white/[0.08] hover:border-white/[0.2] transition-all cursor-pointer group ${
                    selectedPair === pair.symbol ? "border-violet-500/50 shadow-lg shadow-violet-500/10" : ""
                  }`}
                  onClick={() => setSelectedPair(pair.symbol)}
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
                        pair.change24hPercent >= 0 
                          ? "bg-emerald-500/10" 
                          : "bg-rose-500/10"
                      }`}>
                        {pair.change24hPercent >= 0 ? (
                          <ArrowUpRight className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <ArrowDownRight className="w-5 h-5 text-rose-400" />
                        )}
                      </div>
                    </div>
                    
                    <div className="mb-4">
                      <LivePriceChart
                        candles={candlesFor(pair.symbol, selectedInterval).slice(-60).map((c) => ({ time: c.time, close: c.close, volume: c.volume }))}
                        symbol={pair.symbol}
                        currentPrice={pair.price}
                        height={60}
                        showVolume={false}
                        showLabels={false}
                        showGrid={false}
                        showGradient={true}
                        color="violet"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-500">Price</span>
                        <span className="text-lg font-bold text-white">{formatPrice(pair.price)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-500">24h Change</span>
                        <span className={`text-sm font-bold ${
                          pair.change24hPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}>
                          {pair.change24hPercent >= 0 ? "+" : ""}{pair.change24hPercent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    
                    <div className="mt-4 pt-4 border-t border-white/[0.05] flex items-center justify-between">
                      <StatusBadge 
                        status={pair.change24hPercent >= 0 ? "success" : "error"} 
                        label={pair.change24hPercent >= 0 ? "Bullish" : "Bearish"} 
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

            {/* AI Insights Panel */}
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <Card className="bg-[#111118] border-white/[0.08]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-violet-400" />
                      Active Positions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedPairData ? (
                      <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="text-lg font-bold text-white">{selectedPairData.symbol}</span>
                            <StatusBadge status="success" label="Long" />
                          </div>
                          <span className="text-emerald-400 font-bold">+$145.20</span>
                        </div>
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-zinc-500">Entry</span>
                            <div className="font-medium text-white">{formatPrice(selectedPairData.price - 200)}</div>
                          </div>
                          <div>
                            <span className="text-zinc-500">Current</span>
                            <div className="font-medium text-emerald-400">{formatPrice(selectedPairData.price)}</div>
                          </div>
                          <div>
                            <span className="text-zinc-500">Stop</span>
                            <div className="font-medium text-rose-400">{formatPrice(selectedPairData.price - 850)}</div>
                          </div>
                          <div>
                            <span className="text-zinc-500">Target</span>
                            <div className="font-medium text-emerald-400">{formatPrice(selectedPairData.price + 1700)}</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-zinc-500">Select a pair to view positions</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <AIInsightsPanel
                latestSignal={latestSignal}
                signals={aiSignals}
                learningMetrics={learningMetrics}
                isAnalyzing={isAnalyzing}
                onAnalyze={() => selectedPairData && analyzeSymbol(selectedPairData.symbol, selectedPairData.price)}
                onResetLearning={resetLearning}
                patternWeights={getPatternWeights()}
                patternPerformance={patternPerformance}
                regime={regime}
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
                  {selectedPairData ? (
                    <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-bold text-white">{selectedPairData.symbol}</span>
                          <StatusBadge status="success" label="Long" />
                        </div>
                        <span className="text-emerald-400 font-bold">+$145.20</span>
                      </div>
                      <div className="grid grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-zinc-500">Entry</span>
                          <div className="font-medium text-white">{formatPrice(selectedPairData.price - 200)}</div>
                        </div>
                        <div>
                          <span className="text-zinc-500">Current</span>
                          <div className="font-medium text-emerald-400">{formatPrice(selectedPairData.price)}</div>
                        </div>
                        <div>
                          <span className="text-zinc-500">Stop</span>
                          <div className="font-medium text-rose-400">{formatPrice(selectedPairData.price - 850)}</div>
                        </div>
                        <div>
                          <span className="text-zinc-500">Target</span>
                          <div className="font-medium text-emerald-400">{formatPrice(selectedPairData.price + 1700)}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-zinc-500">Select a pair to view positions</div>
                  )}
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
                    {marketData.slice(0, 4).map((pair) => (
                      <div 
                        key={pair.symbol} 
                        className="flex items-center justify-between py-1 cursor-pointer hover:bg-white/[0.03] px-2 rounded"
                        onClick={() => {
                          setSelectedPair(pair.symbol);
                          setActiveTab("markets");
                        }}
                      >
                        <span className="text-sm text-zinc-300">{pair.symbol}</span>
                        <span className={`text-xs font-bold ${
                          pair.change24hPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}>
                          {pair.change24hPercent >= 0 ? "+" : ""}{pair.change24hPercent.toFixed(2)}%
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
                isActive={aiAlwaysRunning}
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
                <SignalList signals={aiSignals} />
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
                        { regime: "Trending", trades: 18, winRate: "72%", expectancy: "+$45.20" },
                        { regime: "Breakout", trades: 12, winRate: "65%", expectancy: "+$38.90" },
                        { regime: "Momentum", trades: 17, winRate: "58%", expectancy: "+$28.40" },
                      ].map((data) => (
                        <div
                          key={data.regime}
                          className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]"
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

          {/* Universal Pair Search & Analysis Tab (registry-backed) */}
          <TabsContent value="pairsearch" className="space-y-6">
            <PairSearchPanel ps={pairSearch} />
          </TabsContent>

          {/* AI Trade Arena Tab */}
          <TabsContent value="arena" className="space-y-6">
            <ArenaPanel
              trades={arenaTrades}
              signals={arenaSignals}
              performance={arenaPerformance}
              status={arenaStatus}
              isActive={arenaActive}
              onStart={startArena}
              onStop={stopArena}
            />
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

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <SettingsTab
              onSave={handleSaveSettings}
              currentDataSource={dataSource}
              feedHealth={feedHealth}
              activeProvider={activeProvider}
              tickAgeMs={tickAgeMs}
            />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
