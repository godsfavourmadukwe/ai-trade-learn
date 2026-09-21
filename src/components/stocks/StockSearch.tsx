import { useState, useCallback, useEffect, useRef } from "react";
import { Search, X, TrendingUp, BarChart3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchStocks, type StockSearchResult } from "@/lib/stocks/data-engine";

interface StockSearchProps {
  onSelect: (symbol: string) => void;
  selectedSymbol?: string;
  className?: string;
}

export function StockSearch({ onSelect, selectedSymbol, className }: StockSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const hits = await searchStocks(q);
      setResults(hits);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (symbol: string) => {
    setQuery("");
    setResults([]);
    setShowDropdown(false);
    onSelect(symbol);
  };

  const quickPicks = ["AAPL", "MSFT", "NVDA", "TSLA", "SPY", "AMZN"];

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <Input
          placeholder="Search stocks (e.g. AAPL, Tesla, Microsoft)..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          className="pl-10 pr-10 bg-white/[0.03] border-white/10 h-11 text-white placeholder:text-zinc-500 focus:border-violet-500/50"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Quick picks */}
      {!query && !showDropdown && (
        <div className="flex flex-wrap gap-2 mt-3">
          {quickPicks.map((sym) => (
            <button
              key={sym}
              onClick={() => handleSelect(sym)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                selectedSymbol === sym
                  ? "bg-violet-500/30 text-white border border-violet-400/40"
                  : "bg-white/[0.05] text-zinc-400 hover:text-white hover:bg-white/[0.1] border border-white/[0.08]"
              }`}
            >
              {sym}
            </button>
          ))}
        </div>
      )}

      {/* Search results dropdown */}
      {showDropdown && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#111118] border border-white/10 rounded-xl shadow-2xl shadow-black/50 z-50 max-h-80 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.symbol}
              onClick={() => handleSelect(r.symbol)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.05] transition-colors text-left border-b border-white/[0.05] last:border-0"
            >
              <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                {r.type === "etf" ? (
                  <BarChart3 className="w-4 h-4 text-violet-400" />
                ) : (
                  <TrendingUp className="w-4 h-4 text-violet-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{r.symbol}</span>
                  <span className="text-xs text-zinc-500 truncate">{r.name}</span>
                </div>
                <div className="text-xs text-zinc-500">
                  {r.exchange} · {r.type.toUpperCase()}
                  {r.marketCap ? ` · $${(r.marketCap / 1e9).toFixed(0)}B` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {showDropdown && query.length >= 1 && results.length === 0 && !loading && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#111118] border border-white/10 rounded-xl shadow-2xl shadow-black/50 z-50 p-4 text-center">
          <p className="text-sm text-zinc-500">No results for "{query}"</p>
        </div>
      )}

      {loading && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#111118] border border-white/10 rounded-xl shadow-2xl shadow-black/50 z-50 p-4 text-center">
          <p className="text-sm text-zinc-500 animate-pulse">Searching...</p>
        </div>
      )}
    </div>
  );
}
