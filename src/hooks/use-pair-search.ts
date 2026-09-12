import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  type RegistryPair,
  type TickerRow,
  type OrderBookTop,
  FALLBACK_PAIRS,
  fetchRegistry,
  fetchTickerIndex,
  fetchTickerFor,
  fetchOrderBookTop,
  fetchPairCandles,
  searchPairs,
  coinName,
} from "@/lib/market/registry";
import {
  type PairAnalysis,
  analyzePair,
  evaluateThesis,
} from "@/lib/market/pair-analysis";
import type { Interval } from "@/lib/market/types";

export interface PairSearchResult {
  pair: RegistryPair;
  ticker: TickerRow | null;
  score: number;
}

export interface SelectedPairDetail {
  pair: RegistryPair | null;
  ticker: TickerRow | null;
  orderBook: OrderBookTop | null;
  candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number; closed: boolean }>;
  loading: boolean;
  dataError: string | null;
}

export interface ThesisResult {
  verdict: "supports" | "mixed" | "contradicts";
  agreementScore: number;
  supporting: string[];
  contradicting: string[];
  risks: string[];
  invalidation: string[];
  conclusion: string;
  symbol: string; // pair the evaluation belongs to — guards against cross-pair display
  evaluatedAt: number;
}

const SEARCH_DEBOUNCE_MS = 200;
const DETAIL_REFRESH_MS = 20_000;

export function usePairSearch() {
  // ── Registry ──
  const [registry, setRegistry] = useState<RegistryPair[]>(FALLBACK_PAIRS);
  const [registrySource, setRegistrySource] = useState<"discovered" | "fallback" | "loading">("loading");
  const tickersRef = useRef<Map<string, TickerRow> | null>(null);
  const [tickersVersion, setTickersVersion] = useState(0);

  // ── Search (debounced) ──
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Selection ──
  const [selected, setSelected] = useState<RegistryPair | null>(null);
  const [detail, setDetail] = useState<SelectedPairDetail>({
    pair: null,
    ticker: null,
    orderBook: null,
    candles: [],
    loading: false,
    dataError: null,
  });

  // ── Analysis ──
  const [analysis, setAnalysis] = useState<PairAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [thesisInput, setThesisInput] = useState("");
  const [thesis, setThesis] = useState<ThesisResult | null>(null);
  const [thesisBusy, setThesisBusy] = useState(false);

  const selectReqId = useRef(0);
  const analyzeReqId = useRef(0);
  const selectedRef = useRef<RegistryPair | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<Interval>("1m");
  const intervalRef = useRef<Interval>("1m");
  intervalRef.current = selectedInterval;

  // ---- Registry discovery (lazy, cached, graceful degradation) ----
  useEffect(() => {
    let alive = true;
    fetchRegistry()
      .then((pairs) => {
        if (!alive) return;
        setRegistry(pairs);
        setRegistrySource("discovered");
      })
      .catch(() => {
        if (alive) setRegistrySource("fallback");
      });
    return () => {
      alive = false;
    };
  }, []);

  // ---- Ticker index (lazy, 60s TTL, refreshed while page visible) ----
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      fetchTickerIndex()
        .then((map) => {
          if (!alive) return;
          tickersRef.current = map;
          setTickersVersion((v) => v + 1);
        })
        .catch(() => { /* index stays null — per-pair fetch covers selection */ })
        .finally(() => {
          if (alive) timer = setTimeout(load, 60_000);
        });
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ---- Debounce search input ----
  const onSearchInput = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(value);
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }, []);

  // ---- Search results (memo, scored) ----
  const searchResults = useMemo(() => {
    void tickersVersion; // recompute when ticker index refreshes
    return searchPairs(debouncedQuery, registry, tickersRef.current, 60);
  }, [debouncedQuery, registry, tickersVersion]);

  // ---- Analysis runner (race-safe) ----
  const runAnalysis = useCallback(async (
    pair: RegistryPair,
    candles: SelectedPairDetail["candles"],
    ticker: TickerRow | null,
    book: OrderBookTop | null,
    reqId: number,
  ) => {
    const aid = ++analyzeReqId.current;
    setAnalyzing(true);
    try {
      const result = analyzePair({
        symbol: pair.symbol,
        exchangeSymbol: pair.exchangeSymbol,
        exchange: pair.exchange,
        candles,
        livePrice: ticker?.price ?? null,
        ticker: ticker
          ? {
              change24hPercent: ticker.change24hPercent,
              high24h: ticker.high24h,
              low24h: ticker.low24h,
              quoteVolume24h: ticker.quoteVolume24h,
            }
          : null,
        orderBook: book,
        now: Date.now(),
      });
      if (aid !== analyzeReqId.current || reqId !== selectReqId.current) return;
      setAnalysis(result);
    } finally {
      if (aid === analyzeReqId.current) setAnalyzing(false);
    }
  }, []);

  // ---- Load detail for the selected pair (race-safe) ----
  const loadDetail = useCallback(async (pair: RegistryPair) => {
    const reqId = ++selectReqId.current;
    setDetail((d) => ({
      pair,
      ticker: d.pair?.exchangeSymbol === pair.exchangeSymbol ? d.ticker : null,
      orderBook: d.pair?.exchangeSymbol === pair.exchangeSymbol ? d.orderBook : null,
      candles: d.pair?.exchangeSymbol === pair.exchangeSymbol ? d.candles : [],
      loading: true,
      dataError: null,
    }));
    setAnalysis(null);
    setThesis(null);
    selectedRef.current = pair;

    const [tickerRes] = await Promise.allSettled([fetchTickerFor(pair.exchangeSymbol)]);
    if (reqId !== selectReqId.current) return; // stale — a newer selection won
    const ticker: TickerRow | null = tickerRes.status === "fulfilled" ? tickerRes.value : null;

    let candles: SelectedPairDetail["candles"] = [];
    let dataError: string | null = null;
    try {
      candles = await fetchPairCandles(pair.exchangeSymbol, intervalRef.current, 300);
    } catch {
      dataError = "Market data unavailable";
    }
    if (reqId !== selectReqId.current) return;

    const book = await fetchOrderBookTop(pair.exchangeSymbol);
    if (reqId !== selectReqId.current) return;

    setDetail({ pair, ticker, orderBook: book, candles, loading: false, dataError });

    // Auto-run quantitative analysis once data is in (skip if data unusable)
    if (candles.length >= 30 || (ticker && ticker.price > 0)) {
      await runAnalysis(pair, candles, ticker, book, reqId);
    }
  }, [runAnalysis]);

  // ---- Refresh loop for the selected pair ----
  useEffect(() => {
    if (!selected) return;
    void loadDetail(selected);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadDetail(selected);
    }, DETAIL_REFRESH_MS);
    return () => clearInterval(timer);
  }, [selected, selectedInterval, loadDetail]);

  // ---- Selection (switching pairs resets ALL pair-specific state) ----
  const selectPair = useCallback((pair: RegistryPair) => {
    if (pair.exchangeSymbol === selectedRef.current?.exchangeSymbol) return;
    selectedRef.current = pair;
    setSelected(pair);
    setThesisInput("");
  }, []);

  const reselectByDisplaySymbol = useCallback((displaySymbol: string): boolean => {
    const found =
      registry.find((p) => p.symbol === displaySymbol) ??
      registry.find((p) => p.exchangeSymbol === displaySymbol.replace("/", "").toUpperCase());
    if (found) {
      selectPair(found);
      return true;
    }
    return false;
  }, [registry, selectPair]);

  // ---- Thesis evaluation (runs on the CURRENT analysis only) ----
  const submitThesis = useCallback(() => {
    const text = thesisInput.trim();
    if (!text || !analysis || !analysis.dataHealth.ok || analyzing) return;
    setThesisBusy(true);
    try {
      const evaluation = evaluateThesis(text, analysis);
      setThesis({
        verdict: evaluation.verdict,
        agreementScore: evaluation.agreementScore,
        supporting: evaluation.supporting,
        contradicting: evaluation.contradicting,
        risks: evaluation.risks,
        invalidation: evaluation.invalidation,
        conclusion: evaluation.conclusion,
        symbol: analysis.symbol,
        evaluatedAt: Date.now(),
      });
    } finally {
      setThesisBusy(false);
    }
  }, [thesisInput, analysis, analyzing]);

  const clearThesis = useCallback(() => setThesis(null), []);

  const nameFor = useCallback((baseAsset: string) => coinName(baseAsset), []);

  return {
    // search
    searchInput,
    onSearchInput,
    searchResults,
    searching: searchInput !== debouncedQuery,
    // registry
    registrySize: registry.length,
    registrySource,
    // selection
    selected,
    selectPair,
    reselectByDisplaySymbol,
    detail,
    selectedInterval,
    setSelectedInterval,
    // analysis
    analysis,
    analyzing,
    refreshSelected: () => {
      if (selectedRef.current) void loadDetail(selectedRef.current);
    },
    // thesis
    thesisInput,
    setThesisInput,
    submitThesis,
    clearThesis,
    thesis,
    thesisBusy,
    nameFor,
  };
}

export type UsePairSearchReturn = ReturnType<typeof usePairSearch>;
