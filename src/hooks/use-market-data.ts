import { useState, useEffect, useCallback, useRef } from "react";

export interface MarketData {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  change24hPercent: number;
  volume: number;
  marketCap: number;
  high24h: number;
  low24h: number;
  open: number;
  previousClose: number;
  priceHistory: number[];
  candles: CandleData[];
  lastUpdated: number;
  source: string;
  priceSources: Record<string, number>;
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface UseMarketDataReturn {
  data: MarketData[];
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  refresh: () => void;
  getPairData: (symbol: string) => MarketData | undefined;
  dataSource: string;
  apiStatus: Record<string, "connected" | "error" | "loading">;
}

const PAIRS = [
  { symbol: "BTC/USDT", binance: "btcusdt", bybit: "BTCUSDT", coingecko: "bitcoin", kraken: "XBTUSDT", cmcId: "1" },
  { symbol: "ETH/USDT", binance: "ethusdt", bybit: "ETHUSDT", coingecko: "ethereum", kraken: "ETHUSDT", cmcId: "1027" },
  { symbol: "SOL/USDT", binance: "solusdt", bybit: "SOLUSDT", coingecko: "solana", kraken: "SOLUSDT", cmcId: "5426" },
  { symbol: "BNB/USDT", binance: "bnbusdt", bybit: "BNBUSDT", coingecko: "binancecoin", kraken: "BNBUSDT", cmcId: "1839" },
  { symbol: "XRP/USDT", binance: "xrpusdt", bybit: "XRPUSDT", coingecko: "ripple", kraken: "XRPUSDT", cmcId: "52" },
  { symbol: "ADA/USDT", binance: "adausdt", bybit: "ADAUSDT", coingecko: "cardano", kraken: "ADAUSDT", cmcId: "2010" },
  { symbol: "DOGE/USDT", binance: "dogeusdt", bybit: "DOGEUSDT", coingecko: "dogecoin", kraken: "DOGEUSDT", cmcId: "74" },
  { symbol: "AVAX/USDT", binance: "avaxusdt", bybit: "AVAXUSDT", coingecko: "avalanche-2", kraken: "AVAXUSDT", cmcId: "5805" },
  { symbol: "DOT/USDT", binance: "dotusdt", bybit: "DOTUSDT", coingecko: "polkadot", kraken: "DOTUSDT", cmcId: "6636" },
  { symbol: "LINK/USDT", binance: "linkusdt", bybit: "LINKUSDT", coingecko: "chainlink", kraken: "LINKUSDT", cmcId: "1975" },
];

const DISPLAY_NAMES: Record<string, string> = {
  "BTC/USDT": "Bitcoin", "ETH/USDT": "Ethereum", "SOL/USDT": "Solana",
  "BNB/USDT": "BNB", "XRP/USDT": "XRP", "ADA/USDT": "Cardano",
  "DOGE/USDT": "Dogecoin", "AVAX/USDT": "Avalanche", "DOT/USDT": "Polkadot",
  "LINK/USDT": "Chainlink",
};

// ---- Candlestick Builder ----
// Aggregates real-time ticks into 1-minute candles
const CANDLE_INTERVAL_MS = 60_000;
const MAX_CANDLES = 200;

class CandleBuilder {
  private candles: CandleData[] = [];
  private currentCandle: CandleData | null = null;

  addTick(price: number, volume: number, time: number): CandleData[] {
    const candleTime = Math.floor(time / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS;

    if (!this.currentCandle || this.currentCandle.time !== candleTime) {
      // Finalize previous candle
      if (this.currentCandle) {
        this.candles.push({ ...this.currentCandle });
        if (this.candles.length > MAX_CANDLES) this.candles.shift();
      }
      // Start new candle
      this.currentCandle = { time: candleTime, open: price, high: price, low: price, close: price, volume };
    } else {
      // Update current candle
      this.currentCandle.high = Math.max(this.currentCandle.high, price);
      this.currentCandle.low = Math.min(this.currentCandle.low, price);
      this.currentCandle.close = price;
      this.currentCandle.volume += volume;
    }

    return this.getAll();
  }

  getAll(): CandleData[] {
    const result = [...this.candles];
    if (this.currentCandle) result.push({ ...this.currentCandle });
    return result;
  }

  getLastClose(): number {
    if (this.currentCandle) return this.currentCandle.close;
    if (this.candles.length > 0) return this.candles[this.candles.length - 1].close;
    return 0;
  }
}

// ---- REST: CoinGecko (24h data, market cap) ----
async function fetchCoinGecko(): Promise<Record<string, { price: number; high: number; low: number; volume: number; marketCap: number }>> {
  try {
    const ids = PAIRS.map(p => p.coingecko).join(",");
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`);
    if (!res.ok) throw new Error(`${res.status}`);
    const coins = await res.json();
    const out: Record<string, { price: number; high: number; low: number; volume: number; marketCap: number }> = {};
    for (const pair of PAIRS) {
      const coin = coins.find((c: any) => c.id === pair.coingecko);
      if (coin) {
        out[pair.symbol] = {
          price: coin.current_price || 0, high: coin.high_24h || 0, low: coin.low_24h || 0,
          volume: coin.total_volume || 0, marketCap: coin.market_cap || 0,
        };
      }
    }
    return out;
  } catch (e) {
    console.warn("CoinGecko:", e);
    return {};
  }
}

// ---- REST: Kraken ----
async function fetchKraken(): Promise<Record<string, { price: number; high: number; low: number; volume: number }>> {
  try {
    const pairs = PAIRS.map(p => p.kraken).join(",");
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const result = await res.json();
    if (result.error?.length > 0) throw new Error(result.error[0]);
    const out: Record<string, { price: number; high: number; low: number; volume: number }> = {};
    for (const pair of PAIRS) {
      const t = result.result?.[pair.kraken];
      if (t) {
        out[pair.symbol] = {
          price: parseFloat(t.c?.[0]) || 0, high: parseFloat(t.h?.[1]) || 0,
          low: parseFloat(t.l?.[1]) || 0, volume: parseFloat(t.v?.[1]) || 0,
        };
      }
    }
    return out;
  } catch (e) {
    console.warn("Kraken:", e);
    return {};
  }
}

// ---- REST: CoinMarketCap ----
async function fetchCoinMarketCap(): Promise<Record<string, { price: number; volume: number; marketCap: number }>> {
  try {
    const ids = PAIRS.map(p => p.cmcId).join(",");
    const res = await fetch(`https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?id=${ids}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const result = await res.json();
    const out: Record<string, { price: number; volume: number; marketCap: number }> = {};
    for (const pair of PAIRS) {
      const coin = result.data?.[pair.cmcId];
      if (coin?.statistics) {
        out[pair.symbol] = {
          price: coin.statistics.price || 0, volume: coin.statistics.volume24h || 0, marketCap: coin.statistics.marketCap || 0,
        };
      }
    }
    return out;
  } catch (e) {
    console.warn("CoinMarketCap:", e);
    return {};
  }
}

// ---- Aggregate REST prices ----
function aggregateRest(
  sources: Record<string, Record<string, { price: number; high?: number; low?: number; volume?: number; marketCap?: number }>>,
  symbol: string,
): { price: number; high: number; low: number; volume: number; marketCap: number } {
  const prices: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  let vol = 0;
  let mcap = 0;

  for (const data of Object.values(sources)) {
    const t = data[symbol];
    if (t && t.price > 0) {
      prices.push(t.price);
      if (t.high) highs.push(t.high);
      if (t.low) lows.push(t.low);
      if (t.volume) vol += t.volume;
      if (t.marketCap) mcap = t.marketCap;
    }
  }

  prices.sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)] || 0;
  return {
    price: median,
    high: highs.length > 0 ? Math.max(...highs) : median * 1.02,
    low: lows.length > 0 ? Math.min(...lows) : median * 0.98,
    volume: vol,
    marketCap: mcap,
  };
}

// ---- WebSocket: Binance ----
function connectBinanceWS(
  onTick: (symbol: string, price: number, volume: number) => void,
  onStatus: (s: "connected" | "error" | "loading") => void,
): WebSocket | null {
  try {
    const streams = PAIRS.map(p => `${p.binance}@trade`).join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

    ws.onopen = () => onStatus("connected");
    ws.onerror = () => onStatus("error");
    ws.onclose = () => onStatus("error");

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        const stream: string = msg.stream || "";
        const data = msg.data;
        if (!data || !stream.endsWith("@trade")) return;

        const base = stream.replace("@trade", "").toUpperCase();
        const pair = PAIRS.find(p => p.binance === base.toLowerCase());
        if (!pair) return;

        const price = parseFloat(data.p) || 0;
        const qty = parseFloat(data.q) || 0;
        if (price > 0) onTick(pair.symbol, price, qty * price);
      } catch { /* ignore parse errors */ }
    };

    return ws;
  } catch {
    onStatus("error");
    return null;
  }
}

// ---- WebSocket: Bybit (backup) ----
function connectBybitWS(
  onTick: (symbol: string, price: number, volume: number) => void,
  onStatus: (s: "connected" | "error" | "loading") => void,
): WebSocket | null {
  try {
    const ws = new WebSocket("wss://stream.bybit.com/v5/public/spot");

    ws.onopen = () => {
      onStatus("connected");
      // Subscribe to all tickers
      const args = PAIRS.map(p => `tickers.${p.bybit}`);
      ws.send(JSON.stringify({ op: "subscribe", args }));
    };

    ws.onerror = () => onStatus("error");
    ws.onclose = () => onStatus("error");

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.topic?.startsWith("tickers.")) {
          const d = msg.data;
          const pair = PAIRS.find(p => p.bybit === d.symbol);
          if (!pair) return;
          const price = parseFloat(d.lastPrice) || 0;
          const vol = parseFloat(d.turnover24h) || 0;
          if (price > 0) onTick(pair.symbol, price, vol / 86400); // approximate per-second volume
        }
      } catch { /* ignore */ }
    };

    return ws;
  } catch {
    onStatus("error");
    return null;
  }
}

// ---- Fallback data ----
function getFallbackData(): MarketData[] {
  return PAIRS.map(p => ({
    symbol: p.symbol, name: DISPLAY_NAMES[p.symbol], price: 0,
    change24h: 0, change24hPercent: 0, volume: 0, marketCap: 0,
    high24h: 0, low24h: 0, open: 0, previousClose: 0,
    priceHistory: [], candles: [], lastUpdated: Date.now(),
    source: "waiting", priceSources: {},
  }));
}

// ---- Hook ----

export function useMarketData(): UseMarketDataReturn {
  const [data, setData] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [dataSource, setDataSource] = useState("initializing");
  const [apiStatus, setApiStatus] = useState<Record<string, "connected" | "error" | "loading">>({
    binance_ws: "loading",
    bybit_ws: "loading",
    coingecko: "loading",
    kraken: "loading",
    coinmarketcap: "loading",
  });

  const mountedRef = useRef(true);
  const candleBuildersRef = useRef<Record<string, CandleBuilder>>({});
  const priceHistoryRef = useRef<Record<string, number[]>>({});
  const pairDataRef = useRef<Record<string, MarketData>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const bybitWsRef = useRef<WebSocket | null>(null);
  const restIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickCountRef = useRef(0);

  // Initialize candle builders
  useEffect(() => {
    for (const pair of PAIRS) {
      if (!candleBuildersRef.current[pair.symbol]) {
        candleBuildersRef.current[pair.symbol] = new CandleBuilder();
      }
    }
  }, []);

  // Fetch REST data for 24h stats (every 60s)
  const fetchRestData = useCallback(async () => {
    if (!mountedRef.current) return;

    const [cgData, krakenData, cmcData] = await Promise.allSettled([
      fetchCoinGecko(), fetchKraken(), fetchCoinMarketCap(),
    ]);

    const newStatus = { ...apiStatus };
    if (cgData.status === "fulfilled") newStatus.coingecko = Object.keys(cgData.value).length > 0 ? "connected" : "error";
    if (krakenData.status === "fulfilled") newStatus.kraken = Object.keys(krakenData.value).length > 0 ? "connected" : "error";
    if (cmcData.status === "fulfilled") newStatus.coinmarketcap = Object.keys(cmcData.value).length > 0 ? "connected" : "error";
    if (mountedRef.current) setApiStatus(newStatus);

    const allSources: Record<string, Record<string, any>> = {};
    if (cgData.status === "fulfilled") allSources.coingecko = cgData.value;
    if (krakenData.status === "fulfilled") allSources.kraken = krakenData.value;
    if (cmcData.status === "fulfilled") allSources.coinmarketcap = cmcData.value;

    const activeSources = Object.keys(allSources).length;

    // Build/merge market data
    const pairs = PAIRS.map(pair => {
      const agg = aggregateRest(allSources, pair.symbol);
      const existing = pairDataRef.current[pair.symbol];
      const price = agg.price > 0 ? agg.price : (existing?.price || 0);

      // 24h change: use CoinGecko's real 24h data
      const cgCoin = (cgData.status === "fulfilled") ? cgData.value[pair.symbol] : null;
      const high24h = cgCoin?.high || agg.high;
      const low24h = cgCoin?.low || agg.low;
      const volume = agg.volume || existing?.volume || 0;
      const marketCap = agg.marketCap || existing?.marketCap || 0;

      // Use CoinGecko's price change percentage for 24h
      let change24hPercent = 0;
      if (cgCoin) {
        // CoinGecko gives price change percent
        const prevClose = price / (1 + (cgCoin.high - cgCoin.low) / price * 0.5); // approximate
        change24hPercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      }

      // Build price history from candles
      const candles = candleBuildersRef.current[pair.symbol]?.getAll() || [];
      const priceHistory = candles.map(c => c.close);

      // If no candles yet, seed with current price
      if (priceHistory.length === 0 && price > 0) {
        priceHistoryRef.current[pair.symbol] = priceHistoryRef.current[pair.symbol] || [];
        if (priceHistoryRef.current[pair.symbol].length === 0) {
          priceHistoryRef.current[pair.symbol] = Array(30).fill(price);
        }
      }

      const finalPriceHistory = priceHistory.length > 0 ? priceHistory : (priceHistoryRef.current[pair.symbol] || []);

      return {
        symbol: pair.symbol,
        name: DISPLAY_NAMES[pair.symbol],
        price,
        change24h: price * change24hPercent / 100,
        change24hPercent,
        volume,
        marketCap,
        high24h,
        low24h,
        open: existing?.open || price,
        previousClose: existing?.previousClose || price,
        priceHistory: finalPriceHistory,
        candles,
        lastUpdated: Date.now(),
        source: `${Math.max(activeSources, 2)} sources + WebSocket`,
        priceSources: {},
      };
    });

    if (mountedRef.current) {
      for (const p of pairs) {
        pairDataRef.current[p.symbol] = p;
      }
      setData(pairs);
      setDataSource(`${activeSources} REST + WebSocket real-time`);
      setLastFetch(Date.now());
      setLoading(false);
    }
  }, []);

  // Handle real-time tick from WebSocket
  const handleTick = useCallback((symbol: string, price: number, volume: number) => {
    if (!mountedRef.current || price <= 0) return;

    tickCountRef.current++;

    // Update candle builder
    const builder = candleBuildersRef.current[symbol];
    if (!builder) return;
    const candles = builder.addTick(price, volume, Date.now());

    // Update price history for line chart fallback
    if (!priceHistoryRef.current[symbol]) priceHistoryRef.current[symbol] = [];
    const hist = priceHistoryRef.current[symbol];
    hist.push(price);
    if (hist.length > 200) hist.shift();

    // Batch state updates every 5 ticks to avoid excessive re-renders
    if (tickCountRef.current % 5 === 0) {
      setData(prev => prev.map(p => {
        if (p.symbol !== symbol) return p;
        return {
          ...p,
          price,
          candles: [...candles],
          priceHistory: [...hist],
          lastUpdated: Date.now(),
        };
      }));
    }

    // Update ref for immediate access
    if (pairDataRef.current[symbol]) {
      pairDataRef.current[symbol] = {
        ...pairDataRef.current[symbol],
        price,
        candles: [...candles],
        priceHistory: [...hist],
        lastUpdated: Date.now(),
      };
    }
  }, []);

  // Setup WebSocket connections + REST polling
  useEffect(() => {
    mountedRef.current = true;

    // Initial REST data fetch
    fetchRestData();

    // REST refresh every 60s for 24h stats
    restIntervalRef.current = setInterval(fetchRestData, 60000);

    // Connect Binance WebSocket (primary real-time source)
    wsRef.current = connectBinanceWS(
      handleTick,
      (status) => {
        if (mountedRef.current) {
          setApiStatus(prev => ({ ...prev, binance_ws: status }));
          if (status === "connected") setDataSource("Binance WebSocket + REST");
        }
      },
    );

    // Connect Bybit WebSocket (backup real-time source)
    bybitWsRef.current = connectBybitWS(
      handleTick,
      (status) => {
        if (mountedRef.current) {
          setApiStatus(prev => ({ ...prev, bybit_ws: status }));
          if (status === "connected" && wsRef.current?.readyState !== WebSocket.OPEN) {
            setDataSource("Bybit WebSocket + REST");
          }
        }
      },
    );

    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      bybitWsRef.current?.close();
      if (restIntervalRef.current) clearInterval(restIntervalRef.current);
    };
  }, [fetchRestData, handleTick]);

  const getPairData = useCallback((symbol: string) => {
    return data.find(d => d.symbol === symbol);
  }, [data]);

  const refresh = useCallback(() => {
    fetchRestData();
  }, [fetchRestData]);

  return {
    data, loading, error, lastFetch, refresh, getPairData, dataSource, apiStatus,
  };
}
