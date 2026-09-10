import { useState, useEffect, useCallback, useRef } from "react";

interface MarketData {
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
  lastUpdated: number;
  source: string;
  priceSources: Record<string, number>;
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

// Symbol mappings for each API
const API_SYMBOLS = {
  bybit: {
    "BTC/USDT": "BTCUSDT",
    "ETH/USDT": "ETHUSDT",
    "SOL/USDT": "SOLUSDT",
    "BNB/USDT": "BNBUSDT",
    "XRP/USDT": "XRPUSDT",
    "ADA/USDT": "ADAUSDT",
    "DOGE/USDT": "DOGEUSDT",
    "AVAX/USDT": "AVAXUSDT",
    "DOT/USDT": "DOTUSDT",
    "LINK/USDT": "LINKUSDT",
    "MATIC/USDT": "MATICUSDT",
    "UNI/USDT": "UNIUSDT",
    "ATOM/USDT": "ATOMUSDT",
    "LTC/USDT": "LTCUSDT",
    "FIL/USDT": "FILUSDT",
  },
  binance: {
    "BTC/USDT": "BTCUSDT",
    "ETH/USDT": "ETHUSDT",
    "SOL/USDT": "SOLUSDT",
    "BNB/USDT": "BNBUSDT",
    "XRP/USDT": "XRPUSDT",
    "ADA/USDT": "ADAUSDT",
    "DOGE/USDT": "DOGEUSDT",
    "AVAX/USDT": "AVAXUSDT",
    "DOT/USDT": "DOTUSDT",
    "LINK/USDT": "LINKUSDT",
    "MATIC/USDT": "MATICUSDT",
    "UNI/USDT": "UNIUSDT",
    "ATOM/USDT": "ATOMUSDT",
    "LTC/USDT": "LTCUSDT",
    "FIL/USDT": "FILUSDT",
  },
  coingecko: {
    "BTC/USDT": "bitcoin",
    "ETH/USDT": "ethereum",
    "SOL/USDT": "solana",
    "BNB/USDT": "binancecoin",
    "XRP/USDT": "ripple",
    "ADA/USDT": "cardano",
    "DOGE/USDT": "dogecoin",
    "AVAX/USDT": "avalanche-2",
    "DOT/USDT": "polkadot",
    "LINK/USDT": "chainlink",
    "MATIC/USDT": "matic-network",
    "UNI/USDT": "uniswap",
    "ATOM/USDT": "cosmos",
    "LTC/USDT": "litecoin",
    "FIL/USDT": "filecoin",
  },
  cryptocompare: {
    "BTC/USDT": "BTC",
    "ETH/USDT": "ETH",
    "SOL/USDT": "SOL",
    "BNB/USDT": "BNB",
    "XRP/USDT": "XRP",
    "ADA/USDT": "ADA",
    "DOGE/USDT": "DOGE",
    "AVAX/USDT": "AVAX",
    "DOT/USDT": "DOT",
    "LINK/USDT": "LINK",
    "MATIC/USDT": "MATIC",
    "UNI/USDT": "UNI",
    "ATOM/USDT": "ATOM",
    "LTC/USDT": "LTC",
    "FIL/USDT": "FIL",
  },
  kraken: {
    "BTC/USDT": "XBTUSDT",
    "ETH/USDT": "ETHUSDT",
    "SOL/USDT": "SOLUSDT",
    "BNB/USDT": "BNBUSDT",
    "XRP/USDT": "XRPUSDT",
    "ADA/USDT": "ADAUSDT",
    "DOGE/USDT": "DOGEUSDT",
    "AVAX/USDT": "AVAXUSDT",
    "DOT/USDT": "DOTUSDT",
    "LINK/USDT": "LINKUSDT",
    "MATIC/USDT": "MATICUSDT",
    "UNI/USDT": "UNIUSDT",
    "ATOM/USDT": "ATOMUSDT",
    "LTC/USDT": "LTCUSDT",
    "FIL/USDT": "FILUSDT",
  },
  coinmarketcap: {
    "BTC/USDT": "1",
    "ETH/USDT": "1027",
    "SOL/USDT": "5426",
    "BNB/USDT": "1839",
    "XRP/USDT": "52",
    "ADA/USDT": "2010",
    "DOGE/USDT": "74",
    "AVAX/USDT": "5805",
    "DOT/USDT": "6636",
    "LINK/USDT": "1975",
    "MATIC/USDT": "3890",
    "UNI/USDT": "7083",
    "ATOM/USDT": "3794",
    "LTC/USDT": "2",
    "FIL/USDT": "2280",
  },
};

const DISPLAY_NAMES: Record<string, string> = {
  "BTC/USDT": "Bitcoin",
  "ETH/USDT": "Ethereum",
  "SOL/USDT": "Solana",
  "BNB/USDT": "BNB",
  "XRP/USDT": "XRP",
  "ADA/USDT": "Cardano",
  "DOGE/USDT": "Dogecoin",
  "AVAX/USDT": "Avalanche",
  "DOT/USDT": "Polkadot",
  "LINK/USDT": "Chainlink",
  "MATIC/USDT": "Polygon",
  "UNI/USDT": "Uniswap",
  "ATOM/USDT": "Cosmos",
  "LTC/USDT": "Litecoin",
  "FIL/USDT": "Filecoin",
};

// Price history cache
const priceHistoryCache: Record<string, number[]> = {};

// No random fake history — we only track real prices as they arrive

// API 1: Bybit
async function fetchBybit(): Promise<Record<string, { price: number; high: number; low: number; volume: number }>> {
  try {
    const response = await fetch("https://api.bybit.com/v5/market/tickers?category=spot");
    if (!response.ok) throw new Error("Bybit failed");
    
    const result = await response.json();
    if (result.retCode !== 0) throw new Error("Bybit error");
    
    const prices: Record<string, { price: number; high: number; low: number; volume: number }> = {};
    
    for (const [symbol, bybitSymbol] of Object.entries(API_SYMBOLS.bybit)) {
      const ticker = result.result?.list?.find((t: any) => t.symbol === bybitSymbol);
      if (ticker) {
        prices[symbol] = {
          price: parseFloat(ticker.lastPrice) || 0,
          high: parseFloat(ticker.highPrice24h) || 0,
          low: parseFloat(ticker.lowPrice24h) || 0,
          volume: parseFloat(ticker.turnover24h) || 0,
        };
      }
    }
    
    return prices;
  } catch (e) {
    console.warn("Bybit API error:", e);
    return {};
  }
}

// API 2: Binance
async function fetchBinance(): Promise<Record<string, { price: number; high: number; low: number; volume: number }>> {
  try {
    const response = await fetch("https://api.binance.com/api/v3/ticker/24hr");
    if (!response.ok) throw new Error("Binance failed");
    
    const tickers = await response.json();
    const prices: Record<string, { price: number; high: number; low: number; volume: number }> = {};
    
    for (const [symbol, binanceSymbol] of Object.entries(API_SYMBOLS.binance)) {
      const ticker = tickers.find((t: any) => t.symbol === binanceSymbol);
      if (ticker) {
        prices[symbol] = {
          price: parseFloat(ticker.lastPrice) || 0,
          high: parseFloat(ticker.highPrice) || 0,
          low: parseFloat(ticker.lowPrice) || 0,
          volume: parseFloat(ticker.quoteVolume) || 0,
        };
      }
    }
    
    return prices;
  } catch (e) {
    console.warn("Binance API error:", e);
    return {};
  }
}

// API 3: CoinGecko
async function fetchCoinGecko(): Promise<Record<string, { price: number; high: number; low: number; volume: number; marketCap: number }>> {
  try {
    const coinIds = Object.values(API_SYMBOLS.coingecko).join(",");
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinIds}&price_change_percentage=24h`
    );
    if (!response.ok) throw new Error("CoinGecko failed");
    
    const coins = await response.json();
    const prices: Record<string, { price: number; high: number; low: number; volume: number; marketCap: number }> = {};
    
    for (const [symbol, coinId] of Object.entries(API_SYMBOLS.coingecko)) {
      const coin = coins.find((c: any) => c.id === coinId);
      if (coin) {
        prices[symbol] = {
          price: coin.current_price || 0,
          high: coin.high_24h || 0,
          low: coin.low_24h || 0,
          volume: coin.total_volume || 0,
          marketCap: coin.market_cap || 0,
        };
      }
    }
    
    return prices;
  } catch (e) {
    console.warn("CoinGecko API error:", e);
    return {};
  }
}

// API 4: CryptoCompare
async function fetchCryptoCompare(): Promise<Record<string, { price: number; high: number; low: number; volume: number }>> {
  try {
    const symbols = Object.values(API_SYMBOLS.cryptocompare).join(",");
    const response = await fetch(
      `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${symbols}&tsyms=USD`
    );
    if (!response.ok) throw new Error("CryptoCompare failed");
    
    const data = await response.json();
    const prices: Record<string, { price: number; high: number; low: number; volume: number }> = {};
    
    for (const [symbol, ccSymbol] of Object.entries(API_SYMBOLS.cryptocompare)) {
      const ticker = data.RAW?.[ccSymbol]?.USD;
      if (ticker) {
        prices[symbol] = {
          price: ticker.PRICE || 0,
          high: ticker.HIGH24HOUR || 0,
          low: ticker.LOW24HOUR || 0,
          volume: ticker.VOLUME24HOURTO || 0,
        };
      }
    }
    
    return prices;
  } catch (e) {
    console.warn("CryptoCompare API error:", e);
    return {};
  }
}

// API 5: Kraken
async function fetchKraken(): Promise<Record<string, { price: number; high: number; low: number; volume: number }>> {
  try {
    const pairs = Object.values(API_SYMBOLS.kraken).join(",");
    const response = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${pairs}`
    );
    if (!response.ok) throw new Error("Kraken failed");
    
    const result = await response.json();
    if (result.error?.length > 0) throw new Error("Kraken error");
    
    const prices: Record<string, { price: number; high: number; low: number; volume: number }> = {};
    
    for (const [symbol, krakenSymbol] of Object.entries(API_SYMBOLS.kraken)) {
      const ticker = result.result?.[krakenSymbol];
      if (ticker) {
        prices[symbol] = {
          price: parseFloat(ticker.c?.[0]) || 0,
          high: parseFloat(ticker.h?.[1]) || 0,
          low: parseFloat(ticker.l?.[1]) || 0,
          volume: parseFloat(ticker.v?.[1]) || 0,
        };
      }
    }
    
    return prices;
  } catch (e) {
    console.warn("Kraken API error:", e);
    return {};
  }
}

// API 6: CoinMarketCap (free tier - limited)
async function fetchCoinMarketCap(): Promise<Record<string, { price: number; volume: number; marketCap: number }>> {
  try {
    const ids = Object.values(API_SYMBOLS.coinmarketcap).join(",");
    const response = await fetch(
      `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?id=${ids}`
    );
    if (!response.ok) throw new Error("CoinMarketCap failed");
    
    const result = await response.json();
    const prices: Record<string, { price: number; volume: number; marketCap: number }> = {};
    
    for (const [symbol, cmcId] of Object.entries(API_SYMBOLS.coinmarketcap)) {
      const coin = result.data?.[cmcId];
      if (coin?.statistics) {
        prices[symbol] = {
          price: coin.statistics.price || 0,
          volume: coin.statistics.volume24h || 0,
          marketCap: coin.statistics.marketCap || 0,
        };
      }
    }
    
    return prices;
  } catch (e) {
    console.warn("CoinMarketCap API error:", e);
    return {};
  }
}

// Aggregate prices from multiple sources
function aggregatePrices(
  sources: Record<string, Record<string, { price: number; high?: number; low?: number; volume?: number; marketCap?: number }>>,
  symbol: string
): { price: number; high: number; low: number; volume: number; marketCap: number } {
  const allPrices: number[] = [];
  const allHighs: number[] = [];
  const allLows: number[] = [];
  let totalVolume = 0;
  let marketCap = 0;
  
  for (const [source, data] of Object.entries(sources)) {
    const ticker = data[symbol];
    if (ticker && ticker.price > 0) {
      allPrices.push(ticker.price);
      if (ticker.high) allHighs.push(ticker.high);
      if (ticker.low) allLows.push(ticker.low);
      if (ticker.volume) totalVolume += ticker.volume;
      if (ticker.marketCap) marketCap = ticker.marketCap;
    }
  }
  
  // Use median for price (more robust than mean)
  allPrices.sort((a, b) => a - b);
  const medianPrice = allPrices[Math.floor(allPrices.length / 2)] || 0;
  
  // Use max high and min low
  const maxHigh = allHighs.length > 0 ? Math.max(...allHighs) : medianPrice * 1.02;
  const minLow = allLows.length > 0 ? Math.min(...allLows) : medianPrice * 0.98;
  
  return {
    price: medianPrice,
    high: maxHigh,
    low: minLow,
    volume: totalVolume,
    marketCap,
  };
}

// Fallback demo data
function getFallbackData(): MarketData[] {
  const pairs = [
    { symbol: "BTC/USDT", name: "Bitcoin", price: 67450.25 },
    { symbol: "ETH/USDT", name: "Ethereum", price: 3542.80 },
    { symbol: "SOL/USDT", name: "Solana", price: 148.65 },
    { symbol: "BNB/USDT", name: "BNB", price: 584.30 },
    { symbol: "XRP/USDT", name: "XRP", price: 0.5234 },
    { symbol: "ADA/USDT", name: "Cardano", price: 0.4521 },
    { symbol: "DOGE/USDT", name: "Dogecoin", price: 0.1234 },
    { symbol: "AVAX/USDT", name: "Avalanche", price: 35.42 },
    { symbol: "DOT/USDT", name: "Polkadot", price: 7.89 },
    { symbol: "LINK/USDT", name: "Chainlink", price: 14.56 },
  ];

  return pairs.map(pair => ({
    ...pair,
    change24h: (Math.random() - 0.4) * pair.price * 0.05,
    change24hPercent: (Math.random() - 0.4) * 5,
    volume: Math.random() * 10000000000,
    marketCap: pair.price * (Math.random() * 1000000000 + 100000000),
    high24h: pair.price * 1.05,
    low24h: pair.price * 0.95,
    open: pair.price * 0.99,
    previousClose: pair.price * 0.98,
    priceHistory: [pair.price],
    lastUpdated: Date.now(),
    source: "demo",
    priceSources: {},
  }));
}

export function useMarketData(refreshInterval: number = 5000): UseMarketDataReturn {
  const [data, setData] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [dataSource, setDataSource] = useState<string>("initializing");
  const [apiStatus, setApiStatus] = useState<Record<string, "connected" | "error" | "loading">>({
    bybit: "loading",
    binance: "loading",
    coingecko: "loading",
    cryptocompare: "loading",
    kraken: "loading",
    coinmarketcap: "loading",
  });
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const fetchCountRef = useRef(0);

  const fetchMarketData = useCallback(async () => {
    if (!mountedRef.current) return;
    
    fetchCountRef.current++;
    const isFirstFetch = fetchCountRef.current === 1;
    
    if (isFirstFetch) {
      setLoading(true);
    }
    
    setError(null);

    // Fetch all APIs in parallel
    const [bybitData, binanceData, coingeckoData, ccData, krakenData, cmcData] = await Promise.allSettled([
      fetchBybit(),
      fetchBinance(),
      fetchCoinGecko(),
      fetchCryptoCompare(),
      fetchKraken(),
      fetchCoinMarketCap(),
    ]);

    // Update API status
    const newStatus: Record<string, "connected" | "error"> = {
      bybit: bybitData.status === "fulfilled" && Object.keys(bybitData.value).length > 0 ? "connected" : "error",
      binance: binanceData.status === "fulfilled" && Object.keys(binanceData.value).length > 0 ? "connected" : "error",
      coingecko: coingeckoData.status === "fulfilled" && Object.keys(coingeckoData.value).length > 0 ? "connected" : "error",
      cryptocompare: ccData.status === "fulfilled" && Object.keys(ccData.value).length > 0 ? "connected" : "error",
      kraken: krakenData.status === "fulfilled" && Object.keys(krakenData.value).length > 0 ? "connected" : "error",
      coinmarketcap: cmcData.status === "fulfilled" && Object.keys(cmcData.value).length > 0 ? "connected" : "error",
    };
    
    if (mountedRef.current) {
      setApiStatus(newStatus);
    }

    // Collect all sources
    const allSources: Record<string, Record<string, { price: number; high?: number; low?: number; volume?: number; marketCap?: number }>> = {};
    
    if (bybitData.status === "fulfilled") allSources.bybit = bybitData.value;
    if (binanceData.status === "fulfilled") allSources.binance = binanceData.value;
    if (coingeckoData.status === "fulfilled") allSources.coingecko = coingeckoData.value;
    if (ccData.status === "fulfilled") allSources.cryptocompare = ccData.value;
    if (krakenData.status === "fulfilled") allSources.kraken = krakenData.value;
    if (cmcData.status === "fulfilled") allSources.coinmarketcap = cmcData.value;

    // Check if we have any data
    const activeSources = Object.keys(allSources).length;
    
    if (activeSources === 0) {
      if (mountedRef.current) {
        if (data.length === 0) {
          setData(getFallbackData());
          setDataSource("Demo (all APIs offline)");
        }
        setLoading(false);
      }
      return;
    }

    // Aggregate prices from all sources
    const marketData: MarketData[] = [];
    const symbols = Object.keys(API_SYMBOLS.bybit);

    for (const symbol of symbols) {
      const aggregated = aggregatePrices(allSources, symbol);
      
      if (aggregated.price > 0) {
        // Update price history cache
        if (!priceHistoryCache[symbol]) {
          // Seed with current price so the chart has data on first render
          priceHistoryCache[symbol] = Array(30).fill(aggregated.price);
        }
        {
          const history = priceHistoryCache[symbol];
          history.push(aggregated.price);
          if (history.length > 200) {
            history.shift();
          }
        }

        // Calculate 24h change from previous data
        const prevData = data.find(d => d.symbol === symbol);
        const previousClose = prevData?.price || aggregated.price;
        const change24h = aggregated.price - previousClose;
        const change24hPercent = previousClose > 0 ? (change24h / previousClose) * 100 : 0;

        marketData.push({
          symbol,
          name: DISPLAY_NAMES[symbol] || symbol.replace("/USDT", ""),
          price: aggregated.price,
          change24h,
          change24hPercent,
          volume: aggregated.volume,
          marketCap: aggregated.marketCap,
          high24h: aggregated.high,
          low24h: aggregated.low,
          open: previousClose,
          previousClose,
          priceHistory: [...priceHistoryCache[symbol]],
          lastUpdated: Date.now(),
          source: `${activeSources} APIs`,
          priceSources: Object.fromEntries(
            Object.entries(allSources).map(([src, data]) => [src, data[symbol]?.price || 0])
          ),
        });
      }
    }

    if (mountedRef.current && marketData.length > 0) {
      setData(marketData);
      setDataSource(`${activeSources} APIs aggregated`);
      setLastFetch(Date.now());
      setLoading(false);
    }
  }, []);

  // Initial fetch and setup 1-second interval
  useEffect(() => {
    mountedRef.current = true;
    
    // Initial fetch
    fetchMarketData();
    
    // Setup 1-second auto-refresh
    intervalRef.current = setInterval(fetchMarketData, refreshInterval);
    
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchMarketData, refreshInterval]);

  const getPairData = useCallback((symbol: string) => {
    return data.find(d => d.symbol === symbol);
  }, [data]);

  const refresh = useCallback(() => {
    fetchMarketData();
  }, [fetchMarketData]);

  return {
    data,
    loading,
    error,
    lastFetch,
    refresh,
    getPairData,
    dataSource,
    apiStatus,
  };
}
