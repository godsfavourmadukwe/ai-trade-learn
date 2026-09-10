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
  source: "bybit" | "coingecko" | "fallback";
}

interface UseMarketDataReturn {
  data: MarketData[];
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  refresh: () => void;
  getPairData: (symbol: string) => MarketData | undefined;
  dataSource: string;
}

// Bybit symbol mapping for crypto pairs
const BYBIT_SYMBOLS: Record<string, string> = {
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
};

// Display names
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

// Cache for price history
const priceHistoryCache: Record<string, number[]> = {};

function generatePriceHistory(currentPrice: number, points: number = 100): number[] {
  const history: number[] = [];
  let price = currentPrice * 0.95;
  
  for (let i = 0; i < points; i++) {
    const change = (Math.random() - 0.48) * (currentPrice * 0.008);
    price = Math.max(price + change, currentPrice * 0.92);
    price = Math.min(price, currentPrice * 1.08);
    history.push(price);
  }
  
  history[history.length - 1] = currentPrice;
  return history;
}

// Fetch from Bybit API
async function fetchBybitData(): Promise<MarketData[]> {
  try {
    // Bybit public API - get all tickers
    const response = await fetch(
      "https://api.bybit.com/v5/market/tickers?category=spot",
      {
        headers: {
          "Accept": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Bybit API error: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.retCode !== 0 || !result.result?.list) {
      throw new Error("Invalid Bybit API response");
    }

    const tickers = result.result.list;
    const marketData: MarketData[] = [];

    for (const [displaySymbol, bybitSymbol] of Object.entries(BYBIT_SYMBOLS)) {
      const ticker = tickers.find((t: any) => t.symbol === bybitSymbol);
      
      if (ticker) {
        const price = parseFloat(ticker.lastPrice) || 0;
        const prevPrice24h = parseFloat(ticker.prevPrice24h) || price;
        const change24h = price - prevPrice24h;
        const change24hPercent = prevPrice24h ? (change24h / prevPrice24h) * 100 : 0;
        const high24h = parseFloat(ticker.highPrice24h) || price;
        const low24h = parseFloat(ticker.lowPrice24h) || price;
        const volume = parseFloat(ticker.turnover24h) || 0;
        
        // Update price history cache
        if (!priceHistoryCache[displaySymbol] || priceHistoryCache[displaySymbol].length === 0) {
          priceHistoryCache[displaySymbol] = generatePriceHistory(price);
        } else {
          const history = priceHistoryCache[displaySymbol];
          history.shift();
          history.push(price);
        }

        marketData.push({
          symbol: displaySymbol,
          name: DISPLAY_NAMES[displaySymbol] || displaySymbol.replace("/USDT", ""),
          price,
          change24h,
          change24hPercent,
          volume,
          marketCap: 0,
          high24h,
          low24h,
          open: prevPrice24h,
          previousClose: prevPrice24h,
          priceHistory: [...priceHistoryCache[displaySymbol]],
          lastUpdated: Date.now(),
          source: "bybit",
        });
      }
    }

    return marketData;
  } catch (error) {
    console.error("Bybit API error:", error);
    throw error;
  }
}

// Fallback to CoinGecko
async function fetchCoinGecko(): Promise<MarketData[]> {
  const COIN_IDS: Record<string, string> = {
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
  };

  const coinIds = Object.values(COIN_IDS).join(",");
  
  const response = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinIds}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h`
  );

  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status}`);
  }

  const coins = await response.json();
  const marketData: MarketData[] = [];

  for (const [symbol, coinId] of Object.entries(COIN_IDS)) {
    const coin = coins.find((c: any) => c.id === coinId);
    
    if (coin) {
      const price = coin.current_price;
      
      if (!priceHistoryCache[symbol] || priceHistoryCache[symbol].length === 0) {
        priceHistoryCache[symbol] = generatePriceHistory(price);
      } else {
        priceHistoryCache[symbol].shift();
        priceHistoryCache[symbol].push(price);
      }
      
      marketData.push({
        symbol,
        name: DISPLAY_NAMES[symbol] || coin.name,
        price,
        change24h: coin.price_change_24h || 0,
        change24hPercent: coin.price_change_percentage_24h || 0,
        volume: coin.total_volume || 0,
        marketCap: coin.market_cap || 0,
        high24h: coin.high_24h || price,
        low24h: coin.low_24h || price,
        open: price * 0.99,
        previousClose: price - (coin.price_change_24h || 0),
        priceHistory: [...priceHistoryCache[symbol]],
        lastUpdated: Date.now(),
        source: "coingecko",
      });
    }
  }

  return marketData;
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
    priceHistory: generatePriceHistory(pair.price),
    lastUpdated: Date.now(),
    source: "fallback" as const,
  }));
}

export function useMarketData(refreshInterval: number = 10000): UseMarketDataReturn {
  const [data, setData] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [dataSource, setDataSource] = useState<string>("initializing");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const fetchMarketData = useCallback(async () => {
    if (!mountedRef.current) return;
    
    try {
      setLoading(true);
      setError(null);

      // Try Bybit first
      try {
        const bybitData = await fetchBybitData();
        if (bybitData.length > 0 && mountedRef.current) {
          setData(bybitData);
          setDataSource("Bybit");
          setLastFetch(Date.now());
          setLoading(false);
          return;
        }
      } catch (bybitError) {
        console.warn("Bybit failed, trying CoinGecko:", bybitError);
      }

      // Fallback to CoinGecko
      try {
        const coingeckoData = await fetchCoinGecko();
        if (mountedRef.current) {
          setData(coingeckoData);
          setDataSource("CoinGecko");
          setLastFetch(Date.now());
          setLoading(false);
          return;
        }
      } catch (coingeckoError) {
        console.warn("CoinGecko failed:", coingeckoError);
      }

      // Use fallback if both fail
      if (mountedRef.current) {
        setData(getFallbackData());
        setDataSource("Demo (offline)");
        setLastFetch(Date.now());
        setLoading(false);
      }
    } catch (err) {
      console.error("Failed to fetch market data:", err);
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to fetch market data");
        setLoading(false);
        
        if (data.length === 0) {
          setData(getFallbackData());
          setDataSource("Demo (offline)");
        }
      }
    }
  }, []);

  // Initial fetch and setup interval
  useEffect(() => {
    mountedRef.current = true;
    
    // Initial fetch
    fetchMarketData();
    
    // Setup auto-refresh interval
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
  };
}
