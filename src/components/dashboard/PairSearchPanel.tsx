import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "./StatusBadge";
import type { UsePairSearchReturn } from "@/hooks/use-pair-search";
import type { ScoredPair } from "@/lib/market/registry";
import type { PairRegime } from "@/lib/market/pair-analysis";
import {
  Search, X, RefreshCw, Database, CheckCircle2, XCircle, MinusCircle,
  AlertTriangle, ShieldAlert, TrendingUp, BrainCircuit, ChevronDown,
} from "lucide-react";

function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "—";
  if (price < 1) return `$${price.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  if (price < 100) return `$${price.toFixed(2)}`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatVolume(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

const REGIME_LABEL: Record<PairRegime, string> = {
  strong_uptrend: "Strong Uptrend",
  uptrend: "Uptrend",
  ranging: "Ranging",
  downtrend: "Downtrend",
  strong_downtrend: "Strong Downtrend",
  high_volatility: "High Volatility",
  low_volatility: "Low Volatility",
  unknown: "Unknown",
};

function regimeTone(r: PairRegime): "success" | "warning" | "error" | "active" {
  if (r === "strong_uptrend" || r === "uptrend") return "success";
  if (r === "strong_downtrend" || r === "downtrend") return "error";
  if (r === "unknown") return "warning";
  return "active";
}

function DataUnavailable({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-8 text-sm text-amber-300">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

export function PairSearchPanel({ ps }: { ps: UsePairSearchReturn }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click / Escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const results = ps.searchResults;
  const showResults = open && ps.searchInput.trim().length > 0;
  const top = useMemo(() => results.slice(0, 8), [results]);

  const select = (r: ScoredPair) => {
    ps.selectPair(r.pair);
    setOpen(false);
    ps.onSearchInput("");
    inputRef.current?.blur();
  };

  const detail = ps.detail;
  const pair = detail.pair;
  const ticker = detail.ticker;
  const analysis = ps.analysis;
  const thesis = ps.thesis;
  const hasData = !detail.loading && !detail.dataError && ticker != null;

  return (
    <div className="space-y-6">
      {/* ── Search + registry status ─────────────────────────── */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-white">Market Pair Search</h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
            <span>
              {ps.registrySource === "discovered"
                ? `${ps.registrySize.toLocaleString()} live pairs from Binance`
                : ps.registrySource === "loading"
                  ? "Discovering supported pairs…"
                  : "Provider unavailable — showing verified pairs"}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
              <Database className="h-3 w-3" />
              {ps.registrySource === "discovered" ? "registry: exchange" : ps.registrySource === "loading" ? "registry: loading" : "registry: fallback"}
            </span>
          </p>
        </div>
        <div ref={boxRef} className="relative w-full md:w-96">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            value={ps.searchInput}
            onChange={(e) => {
              ps.onSearchInput(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search BTC/USDT, BTCUSDT, Bitcoin, SOL…"
            aria-label="Search market pairs"
            className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-10 text-base text-white placeholder:text-zinc-500 focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
          {ps.searchInput.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { ps.onSearchInput(""); inputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {/* Results dropdown */}
          {showResults && (
            <div
              role="listbox"
              aria-label="Search results"
              className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-[#14141d] shadow-2xl shadow-black/60"
            >
              {results.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-zinc-500">
                  {ps.searching ? "Searching…" : `No pair matching "${ps.searchInput}" is available on the connected exchange`}
                </div>
              ) : (
                <>
                  {top.map((r) => {
                    const t = r.ticker;
                    const chg = t?.change24hPercent ?? null;
                    return (
                      <button
                        key={r.pair.exchangeSymbol}
                        role="option"
                        aria-selected={ps.selected?.exchangeSymbol === r.pair.exchangeSymbol}
                        onClick={() => select(r)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.05]"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{r.pair.symbol}</span>
                            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-300">
                              {r.pair.exchange}
                            </span>
                            {ps.selected?.exchangeSymbol === r.pair.exchangeSymbol && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            )}
                          </div>
                          <div className="truncate text-xs text-zinc-500">
                            {ps.nameFor(r.pair.baseAsset) ?? "Crypto"} · Base {r.pair.baseAsset} · Quote {r.pair.quoteAsset}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-bold text-white">
                            {t ? formatPrice(t.price) : "—"}
                          </div>
                          <div className={`text-xs font-semibold ${chg == null ? "text-zinc-500" : chg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {chg == null ? "—" : `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {results.length > top.length && (
                    <div className="border-t border-white/5 px-4 py-2 text-center text-xs text-zinc-600">
                      {results.length - top.length} more — keep typing to narrow
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Selected pair detail ─────────────────────────────── */}
      {pair ? (
        <Card className="border-white/[0.08] bg-[#111118]">
          <CardContent className="p-6">
            <div className="flex flex-col gap-6 lg:flex-row">
              {/* Left: identity + stats */}
              <div className="lg:w-1/3">
                <div className="mb-4 flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20">
                    <span className="text-lg font-bold text-white">{pair.baseAsset.slice(0, 4)}</span>
                  </div>
                  <div>
                    <h3 className="flex items-center gap-2 text-2xl font-extrabold text-white">
                      {pair.symbol}
                      <ChevronDown className="h-4 w-4 text-zinc-600" />
                    </h3>
                    <p className="text-sm text-zinc-400">
                      {ps.nameFor(pair.baseAsset) ?? "Crypto"} · {pair.exchange} · spot
                    </p>
                  </div>
                </div>

                {detail.loading ? (
                  <div className="space-y-3 py-4">
                    <div className="h-10 w-40 animate-pulse rounded-lg bg-white/[0.06]" />
                    <div className="h-4 w-24 animate-pulse rounded bg-white/[0.06]" />
                  </div>
                ) : hasData && ticker ? (
                  <>
                    <div className="mb-2 text-4xl font-extrabold text-white">
                      {formatPrice(ticker.price)}
                    </div>
                    <div className={`mb-6 text-lg font-bold ${ticker.change24hPercent >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {ticker.change24hPercent >= 0 ? "+" : ""}{ticker.change24hPercent.toFixed(2)}%
                      <span className="ml-2 text-sm text-zinc-500">(24h)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-zinc-500">24h High</span>
                        <div className="font-bold text-white">{formatPrice(ticker.high24h)}</div>
                      </div>
                      <div>
                        <span className="text-zinc-500">24h Low</span>
                        <div className="font-bold text-white">{formatPrice(ticker.low24h)}</div>
                      </div>
                      <div>
                        <span className="text-zinc-500">24h Volume</span>
                        <div className="font-bold text-white">{formatVolume(ticker.quoteVolume24h)}</div>
                      </div>
                      <div>
                        <span className="text-zinc-500">Market Status</span>
                        <div className="mt-1">
                          <StatusBadge
                            status={pair.status === "TRADING" ? "success" : "warning"}
                            label={pair.status === "TRADING" ? "Trading" : pair.status}
                          />
                        </div>
                      </div>
                    </div>
                    {detail.orderBook && (
                      <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
                        <span className="text-zinc-500">Book: </span>
                        bid {formatPrice(detail.orderBook.bid)} × {detail.orderBook.bidQty.toPrecision(4)} · ask {formatPrice(detail.orderBook.ask)} × {detail.orderBook.askQty.toPrecision(4)}
                        <span className="ml-2 text-zinc-600">
                          (spread {(((detail.orderBook.ask - detail.orderBook.bid) / ((detail.orderBook.ask + detail.orderBook.bid) / 2)) * 100).toFixed(3)}%)
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <DataUnavailable message={detail.dataError ?? "Market data unavailable"} />
                )}
              </div>

              {/* Right: AI analysis + thesis */}
              <div className="lg:w-2/3">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-zinc-300">
                    <BrainCircuit className="h-4 w-4 text-violet-400" />
                    AI Pair Analysis
                    <span className="font-normal text-zinc-600">({analysis ? analysis.modelVersion : "quant engine"})</span>
                  </h4>
                  <div className="flex items-center gap-2">
                    {ps.analyzing && (
                      <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                        <RefreshCw className="h-3 w-3 animate-spin" /> Analyzing…
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={ps.refreshSelected}
                      disabled={detail.loading}
                      className="border-white/10 text-zinc-300 hover:bg-white/[0.05]"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${detail.loading ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                  </div>
                </div>

                {detail.loading ? (
                  <div className="space-y-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-white/[0.06]" />
                    <div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                    <div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.06]" />
                  </div>
                ) : analysis && analysis.dataHealth.ok ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={regimeTone(analysis.regime)} label={REGIME_LABEL[analysis.regime]} />
                      <span className="text-xs text-zinc-500">
                        confidence {analysis.confidence}% · {analysis.features.samples} candles
                      </span>
                    </div>
                    <p className="text-sm text-zinc-300">{analysis.summary}</p>
                    <ul className="space-y-1.5">
                      {analysis.reasons.slice(0, 6).map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-zinc-400">
                          <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500/70" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <DataUnavailable message={analysis?.dataHealth.message ?? detail.dataError ?? "Market data unavailable — analysis blocked"} />
                )}

                {/* ── User thesis evaluation ── */}
                <div className="mt-6 border-t border-white/[0.06] pt-5">
                  <h5 className="mb-2 flex items-center gap-2 text-sm font-bold text-zinc-300">
                    <ShieldAlert className="h-4 w-4 text-amber-400" />
                    Your Analysis / Thesis
                  </h5>
                  <p className="mb-3 text-xs text-zinc-500">
                    The AI evaluates your thesis against live market data for {pair.symbol} — it will disagree when the evidence disagrees.
                  </p>
                  <Textarea
                    value={ps.thesisInput}
                    onChange={(e) => ps.setThesisInput(e.target.value)}
                    placeholder={`e.g. "${pair.baseAsset} is breaking resistance and I expect continuation."`}
                    rows={3}
                    disabled={!hasData}
                    className="resize-none border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-zinc-600 focus:border-violet-500/50 focus:ring-violet-500/20"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <Button
                      size="sm"
                      onClick={ps.submitThesis}
                      disabled={!hasData || ps.thesisBusy || ps.thesisInput.trim().length === 0 || !analysis?.dataHealth.ok}
                      className="bg-gradient-to-r from-violet-500 to-cyan-500 font-bold text-white shadow-lg shadow-violet-500/25 hover:from-violet-600 hover:to-cyan-600"
                    >
                      {ps.thesisBusy ? "Evaluating…" : "Evaluate Thesis"}
                    </Button>
                    {ps.thesisInput && (
                      <Button variant="ghost" size="sm" onClick={() => ps.setThesisInput("")} className="text-zinc-500 hover:text-white">
                        Clear
                      </Button>
                    )}
                  </div>

                  {thesis && (
                    <div className="mt-4 space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {thesis.verdict === "supports" && <StatusBadge status="success" label="Supports Your Thesis" />}
                          {thesis.verdict === "contradicts" && <StatusBadge status="error" label="Disagrees" />}
                          {thesis.verdict === "mixed" && <StatusBadge status="warning" label="Mixed Evidence" />}
                          <span className="text-xs text-zinc-500">{thesis.symbol}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">agreement</span>
                          <span className={`text-sm font-bold ${thesis.agreementScore >= 65 ? "text-emerald-400" : thesis.agreementScore <= 35 ? "text-rose-400" : "text-amber-400"}`}>
                            {thesis.agreementScore}%
                          </span>
                        </div>
                      </div>

                      <p className="text-sm font-medium text-zinc-200">{thesis.conclusion}</p>

                      {thesis.supporting.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Supporting evidence
                          </div>
                          <ul className="space-y-1">
                            {thesis.supporting.map((s, i) => (
                              <li key={i} className="text-xs text-zinc-400">• {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {thesis.contradicting.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-rose-400">
                            <XCircle className="h-3.5 w-3.5" /> Contradicting evidence
                          </div>
                          <ul className="space-y-1">
                            {thesis.contradicting.map((s, i) => (
                              <li key={i} className="text-xs text-zinc-400">• {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {thesis.risks.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" /> Risks
                          </div>
                          <ul className="space-y-1">
                            {thesis.risks.map((s, i) => (
                              <li key={i} className="text-xs text-zinc-400">• {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {thesis.invalidation.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-cyan-400">
                            <MinusCircle className="h-3.5 w-3.5" /> What would invalidate your thesis
                          </div>
                          <ul className="space-y-1">
                            {thesis.invalidation.map((s, i) => (
                              <li key={i} className="text-xs text-zinc-400">• {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-white/[0.05] pt-2">
                        <span className="text-[10px] text-zinc-600">
                          evaluated {new Date(thesis.evaluatedAt).toLocaleTimeString()} against live {thesis.symbol} data
                        </span>
                        <Button variant="ghost" size="sm" onClick={ps.clearThesis} className="h-7 text-xs text-zinc-500 hover:text-white">
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-white/[0.08] bg-[#111118]">
          <CardContent className="p-8 text-center text-sm text-zinc-500">
            Search and select any pair — e.g. <span className="text-zinc-300">BTC/USDT</span>, <span className="text-zinc-300">BTCUSDT</span> or <span className="text-zinc-300">Bitcoin</span> — to load live market data and run pair-specific AI analysis.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
