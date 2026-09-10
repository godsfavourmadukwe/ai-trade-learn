import { useState, useEffect, useCallback } from "react";

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
  source: "yahoo" | "coingecko" | "fallback";
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

// Yahoo Finance symbol mapping for crypto pairs
const YAHOO_SYMBOLS: Record<string, string> = {
  "BTC/USDT": "BTC-USD",
  "ETH/USDT": "ETH-USD",
  "SOL/USDT": "SOL-USD",
  "BNB/USDT": "BNB-USD",
  "XRP/USDT": "XRP-USD",
  "ADA/USDT": "ADA-USD",
  "DOGE/USDT": "DOGE-USD",
  "AVAX/USDT": "AVAX-USD",
  "DOT/USDT": "DOT-USD",
  "LINK/USDT": "LINK-USD",
  "MATIC/USDT": "MATIC-USD",
  "UNI/USDT": "UNI-USD",
  "ATOM/USDT": "ATOM-USD",
  "LTC/USDT": "LTC-USD",
  "FIL/USDT": "FIL-USD",
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
    const change = (Math.random() - 0.48) * (currentPrice * 0.02);
    price = Math.max(price + change, currentPrice * 0.8);
    history.push(price);
  }
  
  history[history.length - 1] = currentPrice;
  return history;
}

// Fetch from Yahoo Finance API
async function fetchYahooFinance(symbol: string): Promise<Partial<MarketData> | null> {
  try {
    const yahooSymbol = YAHOO_SYMBOLS[symbol] || symbol;
    
    // Yahoo Finance v8 quote endpoint
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!response.ok) {
      console.warn(`Yahoo Finance API error for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result) {
      console.warn(`No data returned from Yahoo Finance for ${symbol}`);
      return null;
    }

    const quote = result.indicators?.quote?.[0];
    const meta = result.meta;
    
    if (!quote || !meta) {
      return null;
    }

    // Get current price from meta or last close
    const currentPrice = meta.regularMarketPrice || quote.close?.[quote.close.length - 1] || 0;
    const previousClose = meta.chartPreviousClose || meta.previousClose || quote.close?.[0] || currentPrice;
    
    // Calculate 24h change
    const change24h = currentPrice - previousClose;
    const change24hPercent = previousClose ? (change24h / previousClose) * 100 : 0;
    
    // Get high/low from the day's data
    const high24h = meta.regularMarketDayHigh || Math.max(...(quote.high || [currentPrice]));
    const low24h = meta.regularMarketDayLow || Math.min(...(quote.low || [currentPrice]));
    
    // Get volume
    const volume = meta.regularMarketVolume || quote.volume?.reduce((a: number, b: number) => a + (b || 0), 0) || 0;

    return {
      price: currentPrice,
      change24h,
      change24hPercent,
      high24h,
      low24h,
      open: meta.regularMarketOpen || quote.open?.[0] || currentPrice,
      previousClose,
      volume,
      lastUpdated: Date.now(),
      source: "yahoo",
    };
  } catch (error) {
    console.error(`Error fetching Yahoo Finance for ${symbol}:`, error);
    return null;
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
      
      if (!priceHistoryCache[coinId] || priceHistoryCache[coinId].length === 0) {
        priceHistoryCache[coinId] = generatePriceHistory(price);
      } else {
        priceHistoryCache[coinId].shift();
        priceHistoryCache[coinId].push(price);
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
        priceHistory: [...priceHistoryCache[coinId]],
        lastUpdated: coin.last_updated ? new Date(coin.last_updated).getTime() : Date.now(),
        source: "coingecko",
      });
    }
  }

  return marketData;
}

export function useMarketData(refreshInterval: number = 30000): UseMarketDataReturn {
  const [data, setData] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [dataSource, setDataSource] = useState<string>("initializing");

  const fetchMarketData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Try Yahoo Finance first
      let yahooResults: MarketData[] = [];
      let yahooSuccess = 0;
      
      const symbols = Object.keys(YAHOO_SYMBOLS);
      
      // Fetch from Yahoo Finance in parallel (batch of 5)
      const batchSize = 5;
      for (let i = 0; i < Math.min(symbols.length, 10); i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(symbol => fetchYahooFinance(symbol))
        );
        
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const symbol = batch[j];
          
          if (result.status === "fulfilled" && result.value) {
            yahooSuccess++;
            const price = result.value.price || 0;
            
            if (!priceHistoryCache[symbol] || priceHistoryCache[symbol].length === 0) {
              priceHistoryCache[symbol] = generatePriceHistory(price);
            } else {
              priceHistoryCache[symbol].shift();
              priceHistoryCache[symbol].push(price);
            }
            
            yahooResults.push({
              symbol,
              name: DISPLAY_NAMES[symbol] || symbol.replace("/USDT", ""),
              price,
              change24h: result.value.change24h || 0,
              change24hPercent: result.value.change24hPercent || 0,
              volume: result.value.volume || 0,
              marketCap: 0, // Yahoo doesn't provide market cap easily
              high24h: result.value.high24h || price,
              low24h: result.value.low24h || price,
              open: result.value.open || price,
              previousClose: result.value.previousClose || price,
              priceHistory: [...priceHistoryCache[symbol]],
              lastUpdated: result.value.lastUpdated || Date.now(),
              source: "yahoo",
            });
          }
        }
      }

      // If Yahoo Finance worked for most pairs, use it
      if (yahooSuccess >= symbols.length * 0.5) {
        setData(yahooResults);
        setDataSource("Yahoo Finance");
        setLastFetch(Date.now());
        setLoading(false);
        return;
      }

      // Fallback to CoinGecko
      console.log("Falling back to CoinGecko API...");
      const coingeckoData = await fetchCoinGecko();
      setData(coingeckoData);
      setDataSource("CoinGecko");
      setLastFetch(Date.now());
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch market data:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch market data");
      setLoading(false);
      setDataSource("error");
      
      // Use fallback demo data if all APIs fail
      if (data.length === 0) {
        setData(getFallbackData());
        setDataSource("demo (offline)");
      }
    }
  }, []);

  useEffect(() => {
    fetchMarketData();
    
    const interval = setInterval(fetchMarketData, refreshInterval);
    
    return () => clearInterval(interval);
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

// Fallback data when APIs are unavailable
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
