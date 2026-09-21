import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { StockSearch } from "./StockSearch";
import { extractFundamentals, type FundamentalData } from "@/lib/stocks/data-engine";
import { useStockStream } from "@/lib/stocks/stream";
import type { StreamStatus } from "@/lib/stocks/stream";
import {
  analyzeStock,
  type StockAnalysis,
  type AnalysisDirection,
} from "@/lib/stocks/analyst";
import type { Candle, Interval } from "@/lib/market/types";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Brain,
  AlertTriangle,
  Target,
  Shield,
  Clock,
  RefreshCw,
  Zap,
  BookOpen,
  Activity,
  LineChart,
} from "lucide-react";

// ── Stock Chart Component ─────────────────────────────────

function StockCandlestickChart({ candles, height = 400, loading = false }: { candles: Candle[]; height?: number; loading?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 20, right: 80, bottom: 50, left: 10 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const volH = 40;
    const priceH = chartH - volH - 8;

    ctx.clearRect(0, 0, w, h);

    const allHigh = Math.max(...candles.map((c) => c.high));
    const allLow = Math.min(...candles.map((c) => c.low));
    const priceRange = allHigh - allLow || 1;
    const pricePad = priceRange * 0.08;
    const pMin = allLow - pricePad;
    const pMax = allHigh + pricePad;
    const pRange = pMax - pMin;

    const maxVol = Math.max(...candles.map((c) => c.volume), 1);
    const candleCount = candles.length;
    const gap = chartW / candleCount;
    const candleW = Math.max(2, gap * 0.7);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = pad.top + (priceH / 5) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    // Price labels
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 5; i++) {
      const y = pad.top + (priceH / 5) * i;
      const price = pMax - (pRange / 5) * i;
      const label = price >= 1000
        ? `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
        : price >= 1 ? `$${price.toFixed(2)}` : `$${price.toFixed(4)}`;
      ctx.fillText(label, w - 8, y + 4);
    }

    // Time labels
    ctx.textAlign = "center";
    const labelStep = Math.max(1, Math.floor(candleCount / 8));
    for (let i = 0; i < candleCount; i += labelStep) {
      const x = pad.left + i * gap + gap / 2;
      const d = new Date(candles[i].time);
      const timeStr = `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
      ctx.fillText(timeStr, x, h - 12);
    }

    // Candles
    for (let i = 0; i < candleCount; i++) {
      const c = candles[i];
      const x = pad.left + i * gap + gap / 2;
      const isUp = c.close >= c.open;

      const color = isUp ? "#10b981" : "#ef4444";
      const highY = pad.top + ((pMax - c.high) / pRange) * priceH;
      const lowY = pad.top + ((pMax - c.low) / pRange) * priceH;
      const openY = pad.top + ((pMax - c.open) / pRange) * priceH;
      const closeY = pad.top + ((pMax - c.close) / pRange) * priceH;

      // Wick
      ctx.strokeStyle = isUp ? "rgba(16,185,129,0.6)" : "rgba(239,68,68,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(openY, closeY);
      const bodyH = Math.max(Math.abs(closeY - openY), 1);
      ctx.fillStyle = color;
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);

      // Volume bar
      const volBarH = (c.volume / maxVol) * volH;
      const volY = pad.top + priceH + 8 + (volH - volBarH);
      ctx.fillStyle = isUp ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)";
      ctx.fillRect(x - candleW / 2, volY, candleW, volBarH);
    }

    // Current price line
    const lastCandle = candles[candles.length - 1];
    const lastY = pad.top + ((pMax - lastCandle.close) / pRange) * priceH;
    const lastColor = lastCandle.close >= lastCandle.open ? "#10b981" : "#ef4444";

    ctx.strokeStyle = lastColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.left, lastY);
    ctx.lineTo(w - pad.right, lastY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price dot + label
    ctx.shadowColor = lastColor;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(w - pad.right, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = lastColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    const priceText = lastCandle.close >= 1000
      ? `$${lastCandle.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$${lastCandle.close.toFixed(2)}`;
    ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
    const tw = ctx.measureText(priceText).width;
    ctx.fillStyle = lastColor;
    ctx.beginPath();
    ctx.roundRect(w - pad.right + 4, lastY - 11, tw + 14, 22, 4);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.fillText(priceText, w - pad.right + 11, lastY + 4);

    cancelAnimationFrame(rafRef.current);
  }, [candles, height]);

  if (candles.length < 2) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <div className="text-center">
          {loading ? (
            <>
              <div className="w-8 h-8 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-zinc-400">Fetching chart data...</p>
              <p className="text-xs text-zinc-600 mt-1">Connecting to data provider</p>
            </>
          ) : (
            <>
              <LineChart className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">No chart data available</p>
              <p className="text-xs text-zinc-600 mt-1">Try a different stock or timeframe</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return <canvas ref={canvasRef} className="w-full" style={{ height: `${height}px` }} />;
}

// ── Analysis Direction Badge ───────────────────────────────

function DirectionBadge({ direction, confidence }: { direction: AnalysisDirection; confidence: number }) {
  const config = {
    bullish: { icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Bullish" },
    bearish: { icon: TrendingDown, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Bearish" },
    neutral: { icon: Minus, color: "text-zinc-400", bg: "bg-zinc-500/10", border: "border-zinc-500/20", label: "Neutral" },
  }[direction];

  const Icon = config.icon;
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${config.bg} border ${config.border}`}>
      <Icon className={`w-4 h-4 ${config.color}`} />
      <span className={`text-sm font-bold ${config.color}`}>{config.label}</span>
      <span className="text-xs text-zinc-500">({(confidence * 100).toFixed(0)}%)</span>
    </div>
  );
}

// ── Stream Status Badge ───────────────────────────────────

const STATUS_META: Record<StreamStatus, { label: string; cls: string; dot: string }> = {
  live: { label: "LIVE", cls: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10", dot: "bg-emerald-400" },
  connecting: { label: "CONNECTING", cls: "text-amber-400 border-amber-500/40 bg-amber-500/10", dot: "bg-amber-400" },
  reconnecting: { label: "RECONNECTING", cls: "text-amber-400 border-amber-500/40 bg-amber-500/10", dot: "bg-amber-400" },
  stale: { label: "STALE", cls: "text-rose-400 border-rose-500/40 bg-rose-500/10", dot: "bg-rose-400" },
  "market-closed": { label: "MARKET CLOSED", cls: "text-zinc-400 border-white/10 bg-white/[0.03]", dot: "bg-zinc-500" },
  error: { label: "ERROR", cls: "text-rose-400 border-rose-500/40 bg-rose-500/10", dot: "bg-rose-400" },
};

function StreamStatusBadge({ status }: { status: StreamStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold tracking-wide ${meta.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${status === "live" ? "animate-pulse" : ""}`} />
      {meta.label}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────

export function StockMarketPage() {
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [interval, setInterval] = useState<Interval>("1d");

  // Live pipeline: REST history builds the chart, Yahoo streamer
  // WebSocket keeps price/candles updating automatically.
  const {
    quote,
    candles,
    fundamentals,
    loading,
    error,
    health,
    refresh: refreshStream,
  } = useStockStream(selectedSymbol, interval);

  const analysis = useMemo<StockAnalysis | null>(() => {
    if (!quote || candles.length < 2) return null;
    return analyzeStock(quote, candles, fundamentals ?? extractFundamentals(quote));
  }, [quote, candles, fundamentals]);

  const handleRefresh = () => refreshStream();

  const formatPrice = (p: number) => {
    if (p >= 1000) return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (p >= 1) return `$${p.toFixed(2)}`;
    return `$${p.toFixed(4)}`;
  };

  return (
    <div className="space-y-6">
      {/* Header with search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
              <LineChart className="w-5 h-5 text-emerald-400" />
            </div>
            Stock Intelligence
          </h2>
          <p className="text-zinc-400 mt-1">AI-powered stock analysis with real-time data</p>
        </div>
        <div className="flex items-center gap-3">
          <StockSearch
            onSelect={setSelectedSymbol}
            selectedSymbol={selectedSymbol}
            className="w-80"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={loading}
            className="h-11 w-11 border-white/10 hover:bg-white/[0.05]"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <Card className="bg-rose-500/10 border-rose-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <p className="text-sm text-rose-300">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Quote Header */}
      {quote && (
        <Card className="bg-[#111118] border-white/[0.08]">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center">
                  <span className="text-xl font-extrabold text-white">
                    {quote.symbol.slice(0, 2)}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-2xl font-extrabold text-white">{quote.symbol}</h3>
                    <Badge variant="outline" className="text-xs border-white/10 text-zinc-400">
                      {quote.exchange}
                    </Badge>
                    <StreamStatusBadge status={health?.status ?? "connecting"} />
                  </div>
                  <p className="text-zinc-400 text-sm">{quote.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-8">
                <div>
                  <div className="text-3xl font-extrabold text-white">
                    {formatPrice(quote.price)}
                  </div>
                  <div className={`text-lg font-bold ${
                    quote.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {quote.changePercent >= 0 ? "+" : ""}{quote.change.toFixed(2)} ({quote.changePercent.toFixed(2)}%)
                  </div>
                </div>

                {analysis && (
                  <DirectionBadge direction={analysis.direction} confidence={analysis.confidence} />
                )}
              </div>
            </div>

            {/* Key Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mt-6 pt-6 border-t border-white/[0.05]">
              {[
                { label: "Open", value: formatPrice(quote.open24h) },
                { label: "Prev Close", value: formatPrice(quote.previousClose) },
                { label: "Day High", value: formatPrice(quote.high24h) },
                { label: "Day Low", value: formatPrice(quote.low24h) },
                { label: "Volume", value: formatVolume(quote.volume) },
                { label: "Avg Vol", value: formatVolume(quote.avgVolume30d) },
                { label: "Mkt Cap", value: formatMarketCap(quote.marketCap) },
                { label: "P/E", value: quote.peRatio?.toFixed(1) ?? "N/A" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-xs text-zinc-500 mb-1">{stat.label}</div>
                  <div className="text-sm font-bold text-white">{stat.value}</div>
                </div>
              ))}
            </div>

            {/* 52-week range */}
            {quote.week52High > 0 && (
              <div className="mt-4 pt-4 border-t border-white/[0.05]">
                <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
                  <span>52W Low: {formatPrice(quote.week52Low)}</span>
                  <span>52W High: {formatPrice(quote.week52High)}</span>
                </div>
                <div className="relative h-2 bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className="absolute h-full bg-gradient-to-r from-rose-500/50 via-amber-500/50 to-emerald-500/50 rounded-full"
                    style={{
                      left: 0,
                      width: `${quote.week52High > quote.week52Low
                        ? ((quote.price - quote.week52Low) / (quote.week52High - quote.week52Low)) * 100
                        : 50}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Chart + Analysis */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="lg:col-span-2">
          <Card className="bg-[#111118] border-white/[0.08]">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-violet-400" />
                  Price Chart
                </CardTitle>
                <div className="flex items-center gap-1">
                  {(["1m", "5m", "15m", "1h", "1d"] as Interval[]).map((iv) => (
                    <button
                      key={iv}
                      onClick={() => setInterval(iv)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        interval === iv
                          ? "bg-violet-500/30 text-white border border-violet-400/40"
                          : "text-zinc-400 hover:text-white hover:bg-white/[0.05] border border-transparent"
                      }`}
                    >
                      {iv.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <StockCandlestickChart candles={candles} height={400} loading={loading} />
            </CardContent>
          </Card>
        </div>

        {/* Analysis Sidebar */}
        <div className="space-y-4">
          {analysis && analysis.sections.slice(0, 4).map((section) => (
            <Card key={section.title} className="bg-[#111118] border-white/[0.08]">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold text-zinc-300 flex items-center gap-2">
                  <SectionIcon title={section.title} />
                  {section.title}
                  <DirectionBadge direction={section.direction} confidence={section.confidence} />
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {section.findings.slice(0, 3).map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                        f.type === "supporting" ? "bg-emerald-500" :
                        f.type === "contradicting" ? "bg-rose-500" : "bg-zinc-500"
                      }`} />
                      <div>
                        <span className="font-bold text-zinc-300">{f.label}:</span>{" "}
                        <span className="text-zinc-400">{f.value}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Risks */}
          {analysis && analysis.risks.length > 0 && (
            <Card className="bg-rose-500/5 border-rose-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Risks
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {analysis.risks.slice(0, 3).map((risk, i) => (
                  <div key={i} className="text-xs text-rose-300/80 mb-1">
                    <span className="font-bold">{risk.label}:</span> {risk.description}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Full Analysis */}
      {analysis && (
        <Card className="bg-[#111118] border-white/[0.08]">
          <CardHeader>
            <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-400" />
              Full Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-300 leading-relaxed mb-6">{analysis.summary}</p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {analysis.sections.map((section) => (
                <div key={section.title} className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                  <div className="flex items-center gap-2 mb-3">
                    <SectionIcon title={section.title} />
                    <span className="text-sm font-bold text-white">{section.title}</span>
                  </div>
                  <div className="space-y-2">
                    {section.findings.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                          f.type === "supporting" ? "bg-emerald-500" :
                          f.type === "contradicting" ? "bg-rose-500" : "bg-zinc-500"
                        }`} />
                        <div>
                          <span className="font-bold text-zinc-300">{f.label}</span>
                          <p className="text-zinc-500 mt-0.5">{f.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Invalidation Conditions */}
            <div className="mt-6 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <h4 className="text-sm font-bold text-amber-300 flex items-center gap-2 mb-2">
                <Target className="w-4 h-4" />
                Invalidation Conditions
              </h4>
              <div className="grid md:grid-cols-3 gap-2">
                {analysis.invalidationConditions.map((cond, i) => (
                  <div key={i} className="text-xs text-amber-300/80 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500/50 flex-shrink-0" />
                    {cond}
                  </div>
                ))}
              </div>
            </div>

            {/* Key Levels */}
            <div className="mt-4 grid md:grid-cols-3 gap-4">
              {analysis.keyLevels.support.length > 0 && (
                <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                  <h4 className="text-xs font-bold text-emerald-400 mb-2">Support Levels</h4>
                  {analysis.keyLevels.support.map((s, i) => (
                    <div key={i} className="text-sm font-bold text-emerald-300">{formatPrice(s)}</div>
                  ))}
                </div>
              )}
              {analysis.keyLevels.resistance.length > 0 && (
                <div className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/20">
                  <h4 className="text-xs font-bold text-rose-400 mb-2">Resistance Levels</h4>
                  {analysis.keyLevels.resistance.map((r, i) => (
                    <div key={i} className="text-sm font-bold text-rose-300">{formatPrice(r)}</div>
                  ))}
                </div>
              )}
              {analysis.keyLevels.stopLoss && (
                <div className="p-4 rounded-xl bg-zinc-500/5 border border-zinc-500/20">
                  <h4 className="text-xs font-bold text-zinc-400 mb-2">Risk Levels</h4>
                  <div className="text-xs text-zinc-400">
                    Stop: <span className="font-bold text-rose-300">{formatPrice(analysis.keyLevels.stopLoss)}</span>
                  </div>
                  {analysis.keyLevels.takeProfit && (
                    <div className="text-xs text-zinc-400">
                      Target: <span className="font-bold text-emerald-300">{formatPrice(analysis.keyLevels.takeProfit)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Status */}
      {health && (
        <div className="text-center text-xs text-zinc-600">
          Data provided by Yahoo Finance · {STATUS_META[health.status].label}
          {health.lastTickAt > 0 && (
            <> · Last tick: {new Date(health.lastTickAt).toLocaleTimeString()}</>
          )}
          {health.reconnectCount > 0 && <> · Reconnects: {health.reconnectCount}</>}
          {health.status === "stale" && <> · Attempting recovery…</>}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────

function formatVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
  return `$${cap.toFixed(0)}`;
}

function SectionIcon({ title }: { title: string }) {
  const iconClass = "w-3.5 h-3.5";
  switch (title) {
    case "Technical Indicators": return <Activity className={`${iconClass} text-cyan-400`} />;
    case "Trend Analysis": return <TrendingUp className={`${iconClass} text-emerald-400`} />;
    case "Momentum": return <Zap className={`${iconClass} text-amber-400`} />;
    case "Volatility & Risk": return <Shield className={`${iconClass} text-rose-400`} />;
    case "Volume Analysis": return <BarChart3 className={`${iconClass} text-violet-400`} />;
    case "Support & Resistance": return <Target className={`${iconClass} text-blue-400`} />;
    case "Fundamentals": return <BookOpen className={`${iconClass} text-indigo-400`} />;
    case "Valuation & Range": return <Clock className={`${iconClass} text-zinc-400`} />;
    default: return <Brain className={`${iconClass} text-zinc-400`} />;
  }
}
