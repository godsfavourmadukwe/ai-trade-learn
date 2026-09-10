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
  priceHistory: number[];
  lastUpdated: number;
}

interface UseMarketDataReturn {
  data: MarketData[];
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  refresh: () => void;
  getPairData: (symbol: string) => MarketData | undefined;
}

// CoinGecko coin IDs for common trading pairs
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
  "MATIC/USDT": "matic-network",
  "UNI/USDT": "uniswap",
  "ATOM/USDT": "cosmos",
  "LTC/USDT": "litecoin",
  "FIL/USDT": "filecoin",
};

// Cache for price history (simulated)
const priceHistoryCache: Record<string, number[]> = {};

function generatePriceHistory(currentPrice: number, points: number = 100): number[] {
  const history: number[] = [];
  let price = currentPrice * 0.95; // Start 5% below current
  
  for (let i = 0; i < points; i++) {
    const change = (Math.random() - 0.48) * (currentPrice * 0.02); // Slight upward bias
    price = Math.max(price + change, currentPrice * 0.8); // Don't go below 80% of current
    history.push(price);
  }
  
  // Ensure last point is close to current price
  history[history.length - 1] = currentPrice;
  return history;
}

export function useMarketData(refreshInterval: number = 30000): UseMarketDataReturn {
  const [data, setData] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  const fetchMarketData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const coinIds = Object.values(COIN_IDS).join(",");
      
      // Fetch from CoinGecko API (free tier)
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinIds}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h`
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const coins = await response.json();
      
      const marketData: MarketData[] = [];
      
      for (const [symbol, coinId] of Object.entries(COIN_IDS)) {
        const coin = coins.find((c: any) => c.id === coinId);
        
        if (coin) {
          const price = coin.current_price;
          
          // Generate or get cached price history
          if (!priceHistoryCache[coinId] || priceHistoryCache[coinId].length === 0) {
            priceHistoryCache[coinId] = generatePriceHistory(price);
          } else {
            // Add new price to history and remove oldest
            priceHistoryCache[coinId].shift();
            priceHistoryCache[coinId].push(price);
          }
          
          marketData.push({
            symbol,
            name: coin.name,
            price,
            change24h: coin.price_change_24h || 0,
            change24hPercent: coin.price_change_percentage_24h || 0,
            volume: coin.total_volume || 0,
            marketCap: coin.market_cap || 0,
            high24h: coin.high_24h || price,
            low24h: coin.low_24h || price,
            priceHistory: [...priceHistoryCache[coinId]],
            lastUpdated: coin.last_updated ? new Date(coin.last_updated).getTime() : Date.now(),
          });
        }
      }
      
      setData(marketData);
      setLastFetch(Date.now());
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch market data:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch market data");
      setLoading(false);
      
      // Use fallback demo data if API fails
      if (data.length === 0) {
        setData(getFallbackData());
      }
    }
  }, []);

  useEffect(() => {
    fetchMarketData();
    
    // Set up refresh interval
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
  };
}

// Fallback data when API is unavailable
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
    priceHistory: generatePriceHistory(pair.price),
    lastUpdated: Date.now(),
  }));
}
