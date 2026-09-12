// ============================================================
// TRADSLY Universal Market Registry
//
// Discovers all spot pairs actually supported by the connected
// market-data provider (Binance public market-data endpoints —
// geo-unrestricted mirrors of api.binance.com).
//
// Guarantees:
//  - Every pair listed here exists on the exchange (status=TRADING).
//  - Never invents pairs; on fetch failure it degrades to a small
//    curated list of verified pairs.
//  - One canonical internal format: "BASE/QUOTE" display symbol,
//    with the exchange-native symbol preserved.
// ============================================================

import type { Interval } from "./types";

export interface RegistryPair {
  /** Exchange-native symbol, e.g. "BTCUSDT". */
  exchangeSymbol: string;
  /** Canonical display symbol, e.g. "BTC/USDT". */
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: string;
  status: "TRADING" | "BREAK" | "HALT";
  pricePrecision: number;
  quantityPrecision: number;
}

export interface TickerRow {
  symbol: string; // exchange-native
  price: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  quoteVolume24h: number;
  open24h: number;
  fetchedAt: number;
}

export interface OrderBookTop {
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  fetchedAt: number;
}

// Public market-data endpoints (geo-unrestricted). Same trade data
// as api.binance.com; api.binance.com kept as a fallback.
const REST_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
];

/** Quote assets the app supports end-to-end (analysis, candles, prices). */
export const SUPPORTED_QUOTES = ["USDT", "USDC", "FDUSD", "BTC", "ETH"] as const;

/** Search tie-break priority: USDT pairs rank above other quotes. */
const QUOTE_PRIORITY = ["USDT", "FDUSD", "USDC", "BTC", "ETH"];

/** Known quote assets, longest first, used only to SPLIT exchange symbols. */
const QUOTE_SPLIT_LIST = [
  "USDT", "USDC", "FDUSD", "TUSD", "BUSD", "USDP", "USD1", "EURI", "AEUR",
  "DAI", "XUSD", "USDS", "IDRT", "PAXG", "WBTC", "WBETH", "WETH",
  "TRY", "EUR", "GBP", "AUD", "BRL", "JPY", "RUB", "UAH", "ZAR", "RON",
  "CZK", "PLN", "MXN", "NGN", "ARS", "COP", "CLP", "SAR", "AED", "VND",
  "INR", "KRW", "PKR", "PHP", "TWD", "HUF", "NZD", "USD",
  "BTC", "ETH", "BNB", "TRX", "XRP", "DOGE", "SOL", "ADA", "DOT", "LINK",
];

/** Well-known coin names (search aid only — pairs still come from the exchange). */
const COIN_NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", BNB: "BNB", XRP: "XRP",
  ADA: "Cardano", DOGE: "Dogecoin", AVAX: "Avalanche", DOT: "Polkadot",
  LINK: "Chainlink", TRX: "TRON", LTC: "Litecoin", BCH: "Bitcoin Cash",
  SHIB: "Shiba Inu", PEPE: "Pepe", UNI: "Uniswap", ATOM: "Cosmos",
  XLM: "Stellar", NEAR: "NEAR Protocol", APT: "Aptos", ARB: "Arbitrum",
  OP: "Optimism", FIL: "Filecoin", ICP: "Internet Computer",
  INJ: "Injective", SUI: "Sui", TON: "Toncoin", AAVE: "Aave",
  MKR: "Maker", FET: "Artificial Superintelligence Alliance",
  WIF: "dogwifhat", BONK: "Bonk", FLOKI: "Floki", ALGO: "Algorand",
  VET: "VeChain", HBAR: "Hedera", FTM: "Fantom", GRT: "The Graph",
  SAND: "The Sandbox", MANA: "Decentraland", AXS: "Axie Infinity",
  GALA: "Gala", CHZ: "Chiliz", EOS: "EOS", XTZ: "Tezos", CAKE: "PancakeSwap",
  CRV: "Curve DAO", LDO: "Lido DAO", SNX: "Synthetix", COMP: "Compound",
  DYDX: "dYdX", RUNE: "THORChain", KAVA: "Kava", ZIL: "Zilliqa",
  ETC: "Ethereum Classic", XMR: "Monero", ZEC: "Zcash", DASH: "Dash",
  EGLD: "MultiversX", THETA: "Theta Network", ENJ: "Enjin",
  WLD: "Worldcoin", TIA: "Celestia", SEI: "Sei", ORDI: "ORDI",
  JUP: "Jupiter", PYTH: "Pyth Network", STX: "Stacked", IMX: "Immutable",
  "1000SATS": "SATS", NOT: "Notcoin", BOME: "BOOK OF MEME",
};

/** Curated verified pairs used before/if discovery succeeds. */
export const FALLBACK_PAIRS: RegistryPair[] = [
  { exchangeSymbol: "BTCUSDT", symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", exchange: "binance", status: "TRADING", pricePrecision: 2, quantityPrecision: 5 },
  { exchangeSymbol: "ETHUSDT", symbol: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT", exchange: "binance", status: "TRADING", pricePrecision: 2, quantityPrecision: 4 },
  { exchangeSymbol: "SOLUSDT", symbol: "SOL/USDT", baseAsset: "SOL", quoteAsset: "USDT", exchange: "binance", status: "TRADING", pricePrecision: 2, quantityPrecision: 2 },
  { exchangeSymbol: "BNBUSDT", symbol: "BNB/USDT", baseAsset: "BNB", quoteAsset: "USDT", exchange: "binance", status: "TRADING", pricePrecision: 2, quantityPrecision: 3 },
  { exchangeSymbol: "XRPUSDT", symbol: "XRP/USDT", baseAsset: "XRP", quoteAsset: "USDT", exchange: "binance", status: "TRADING", pricePrecision: 4, quantityPrecision: 1 },
  { exchangeSymbol: "ADAUSDT", symbol: "ADA/USDT", baseAsset: "ADA", quoteAsset: "USDT", exchange: "binance", status: "TRADING", pricePrecision: 4, quantityPrecision: 1 },
  { exchangeSymbol: "DOGEUSDT", symbol: "DOGE/USDT", baseAsset: "DOGE", quoteAsset: "USDT", exchange: "binance", status: "TRADING", pricePrecision: 5, quantityPrecision: 0 },
  { exchangeSymbol: "AVAXUSDT", symbol: "AVAX/USDT", baseAsset: "AVAX", quoteAsset: "USDT", exchange: "binance", status: "TRADING", pricePrecision: 3, quantityPrecision: 2 },
  { exchangeSymbol: "DOTUSDT", symbol: "DOT/USDT", baseAsset: "DOT", quoteAsset: "USDT", exchange: "binance", status: "TRADING", pricePrecision: 3, quantityPrecision: 2 },
  { exchangeSymbol: "LINKUSDT", symbol: "LINK/USDT", baseAsset: "LINK", quoteAsset: "USDT", exchange: "binance", status: "TRADING", pricePrecision: 3, quantityPrecision: 2 },
];

// ------------------------------------------------------------
// Symbol format conversion (single source of truth)
// ------------------------------------------------------------

/** "BTCUSDT" → { base: "BTC", quote: "USDT" } (null when un-splittable). */
export function splitExchangeSymbol(
  exchangeSymbol: string,
): { base: string; quote: string } | null {
  const s = exchangeSymbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length < 5) return null;
  for (const q of QUOTE_SPLIT_LIST) {
    if (s.endsWith(q) && s.length > q.length) {
      return { base: s.slice(0, s.length - q.length), quote: q };
    }
  }
  return null;
}

/** "BTCUSDT" → "BTC/USDT" (null when un-splittable). */
export function exchangeToDisplay(exchangeSymbol: string): string | null {
  const parts = splitExchangeSymbol(exchangeSymbol);
  return parts ? `${parts.base}/${parts.quote}` : null;
}

/** "BTC/USDT" | "btc usdt" | "BTCUSDT" → "BTCUSDT". */
export function normalizeToExchangeSymbol(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function coinName(baseAsset: string): string | undefined {
  return COIN_NAMES[baseAsset.toUpperCase()];
}

// ------------------------------------------------------------
// Fetch helpers (timeout + host failover)
// ------------------------------------------------------------

async function fetchJson<T>(path: string, timeoutMs = 12_000): Promise<T> {
  let lastErr: unknown = null;
  for (const host of REST_HOSTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${host}${path}`, { signal: ctrl.signal });
      if (res.ok) return (await res.json()) as T;
      lastErr = new Error(`HTTP ${res.status} from ${host}`);
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

// ------------------------------------------------------------
// Registry discovery (cached)
// ------------------------------------------------------------

interface RawExchangeInfoSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed?: boolean;
  baseAssetPrecision?: number;
  quotePrecision?: number;
}

let registryCache: { pairs: RegistryPair[]; expires: number } | null = null;
let registryInFlight: Promise<RegistryPair[]> | null = null;
const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000;

async function discoverPairs(): Promise<RegistryPair[]> {
  const info = await fetchJson<{ symbols: RawExchangeInfoSymbol[] }>(
    "/api/v3/exchangeInfo?permissions=SPOT",
    20_000,
  );
  const quotes = new Set<string>(SUPPORTED_QUOTES);
  const pairs: RegistryPair[] = [];
  for (const s of info.symbols ?? []) {
    if (s.status !== "TRADING") continue;
    if (s.isSpotTradingAllowed === false) continue;
    if (!quotes.has(s.quoteAsset)) continue;
    pairs.push({
      exchangeSymbol: s.symbol,
      symbol: `${s.baseAsset}/${s.quoteAsset}`,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      exchange: "binance",
      status: "TRADING",
      pricePrecision: s.quotePrecision ?? 8,
      quantityPrecision: s.baseAssetPrecision ?? 8,
    });
  }
  if (pairs.length === 0) throw new Error("registry empty");
  return pairs;
}

/** All supported pairs from the provider (cached 24h, deduped in-flight). */
export async function fetchRegistry(): Promise<RegistryPair[]> {
  if (registryCache && Date.now() < registryCache.expires) return registryCache.pairs;
  if (!registryInFlight) {
    registryInFlight = discoverPairs()
      .then((pairs) => {
        registryCache = { pairs, expires: Date.now() + REGISTRY_TTL_MS };
        return pairs;
      })
      .finally(() => {
        registryInFlight = null;
      });
  }
  return registryInFlight;
}

// ------------------------------------------------------------
// Ticker index + single ticker + order book (cached)
// ------------------------------------------------------------

interface RawTicker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
  openPrice: string;
}

let tickerIndexCache: { map: Map<string, TickerRow>; expires: number } | null = null;
let tickerIndexInFlight: Promise<Map<string, TickerRow>> | null = null;
const TICKER_INDEX_TTL_MS = 60_000;

/**
 * Full 24h ticker index for every exchange pair (cached 60s).
 * Prefer `fetchTickersFor(symbols)` in the browser — it moves ~4KB instead
 * of the full-market ~2.5MB payload.
 */
export async function fetchTickerIndex(): Promise<Map<string, TickerRow>> {
  if (tickerIndexCache && Date.now() < tickerIndexCache.expires) return tickerIndexCache.map;
  if (!tickerIndexInFlight) {
    const now = Date.now();
    tickerIndexInFlight = fetchJson<RawTicker24h[]>("/api/v3/ticker/24hr", 15_000)
      .then((rows) => {
        const map = new Map<string, TickerRow>();
        for (const r of rows) {
          const row = toTickerRow(r, now);
          if (row) map.set(row.symbol, row);
        }
        tickerIndexCache = { map, expires: Date.now() + TICKER_INDEX_TTL_MS };
        return map;
      })
      .finally(() => {
        tickerIndexInFlight = null;
      });
  }
  return tickerIndexInFlight;
}

let batchedTickerCache: { key: string; map: Map<string, TickerRow>; expires: number } | null = null;
let batchedTickerInFlight: Promise<Map<string, TickerRow>> | null = null;

/**
 * 24h tickers for an explicit symbol list (cached 60s, ~4KB per request).
 * Browser-friendly replacement for the full-market index.
 */
export async function fetchTickersFor(symbols: string[]): Promise<Map<string, TickerRow>> {
  const key = symbols.join(",");
  if (batchedTickerCache && Date.now() < batchedTickerCache.expires && batchedTickerCache.key === key) {
    return batchedTickerCache.map;
  }
  if (batchedTickerInFlight) return batchedTickerInFlight;
  const now = Date.now();
  const p = fetchJson<RawTicker24h[]>(
    `/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
    15_000,
  )
    .then((rows) => {
      const map = new Map<string, TickerRow>();
      for (const r of rows) {
        const row = toTickerRow(r, now);
        if (row) map.set(row.symbol, row);
      }
      batchedTickerCache = { key, map, expires: Date.now() + 60_000 };
      return map;
    })
    .finally(() => {
      batchedTickerInFlight = null;
    });
  batchedTickerInFlight = p;
  return p;
}

function toTickerRow(t: RawTicker24h, now: number): TickerRow | null {
  const price = parseFloat(t.lastPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    symbol: t.symbol,
    price,
    change24hPercent: parseFloat(t.priceChangePercent) || 0,
    high24h: parseFloat(t.highPrice) || price,
    low24h: parseFloat(t.lowPrice) || price,
    quoteVolume24h: parseFloat(t.quoteVolume) || 0,
    open24h: parseFloat(t.openPrice) || price,
    fetchedAt: now,
  };
}

const singleTickerCache = new Map<string, TickerRow>();
const singleTickerInFlight = new Map<string, Promise<TickerRow | null>>();

/** Fresh 24h ticker for ONE pair (cached 15s). */
export async function fetchTickerFor(exchangeSymbol: string): Promise<TickerRow | null> {
  const cached = singleTickerCache.get(exchangeSymbol);
  if (cached && Date.now() - cached.fetchedAt < 15_000) return cached;
  const inFlight = singleTickerInFlight.get(exchangeSymbol);
  if (inFlight) return inFlight;
  const p = fetchJson<RawTicker24h>(
    `/api/v3/ticker/24hr?symbol=${encodeURIComponent(exchangeSymbol)}`,
    10_000,
  )
    .then((t) => {
      const row = toTickerRow(t, Date.now());
      if (row) singleTickerCache.set(exchangeSymbol, row);
      return row;
    })
    .catch(() => null)
    .finally(() => {
      singleTickerInFlight.delete(exchangeSymbol);
    });
  singleTickerInFlight.set(exchangeSymbol, p);
  return p;
}

const bookCache = new Map<string, OrderBookTop>();
const bookInFlight = new Map<string, Promise<OrderBookTop | null>>();

/** Top-of-book snapshot for order-flow context (cached 10s, best-effort). */
export async function fetchOrderBookTop(exchangeSymbol: string): Promise<OrderBookTop | null> {
  const cached = bookCache.get(exchangeSymbol);
  if (cached && Date.now() - cached.fetchedAt < 10_000) return cached;
  const inFlight = bookInFlight.get(exchangeSymbol);
  if (inFlight) return inFlight;
  const p = fetchJson<{ bids: [string, string][]; asks: [string, string][] }>(
    `/api/v3/depth?symbol=${encodeURIComponent(exchangeSymbol)}&limit=5`,
    8_000,
  )
    .then((d) => {
      const bid = parseFloat(d.bids?.[0]?.[0] ?? "0");
      const bidQty = parseFloat(d.bids?.[0]?.[1] ?? "0");
      const ask = parseFloat(d.asks?.[0]?.[0] ?? "0");
      const askQty = parseFloat(d.asks?.[0]?.[1] ?? "0");
      if (!(bid > 0) || !(ask > 0)) return null;
      const top: OrderBookTop = { bid, ask, bidQty, askQty, fetchedAt: Date.now() };
      bookCache.set(exchangeSymbol, top);
      return top;
    })
    .catch(() => null)
    .finally(() => {
      bookInFlight.delete(exchangeSymbol);
    });
  bookInFlight.set(exchangeSymbol, p);
  return p;
}

/** Historical candles for ANY registered pair (used for pair-specific analysis). */
export async function fetchPairCandles(
  exchangeSymbol: string,
  interval: Interval,
  limit = 300,
): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number; closed: boolean }>> {
  const rows = await fetchJson<unknown[][]>(
    `/api/v3/klines?symbol=${encodeURIComponent(exchangeSymbol)}&interval=${interval}&limit=${limit}`,
    12_000,
  );
  if (!Array.isArray(rows)) throw new Error("unexpected klines payload");
  const out: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number; closed: boolean }> = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const time = Number(r[0]);
    const open = Number(r[1]);
    const high = Number(r[2]);
    const low = Number(r[3]);
    const close = Number(r[4]);
    const volume = Number(r[5]);
    if (![time, open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) continue;
    if (high < low) continue;
    out.push({ time, open, high, low, close, volume, closed: true });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

// ------------------------------------------------------------
// Search (case-insensitive, multi-format, scored)
// ------------------------------------------------------------

export interface ScoredPair {
  pair: RegistryPair;
  ticker: TickerRow | null;
  score: number;
}

/**
 * Score a registry pair against a normalized query.
 * Returns 0 when the pair does not match.
 */
export function scorePair(pair: RegistryPair, q: string, name: string | undefined): number {
  if (!q) return 0;
  const exch = pair.exchangeSymbol; // already uppercase, alnum only
  const disp = normalizeToExchangeSymbol(pair.symbol);
  const base = pair.baseAsset.toUpperCase();
  const quote = pair.quoteAsset.toUpperCase();
  const nm = (name ?? "").toUpperCase();

  if (exch === q) return 1000;
  if (disp === q) return 990;
  if (base === q) return 980;
  if (nm === q) return 970;
  if (exch.startsWith(q)) return 800;
  if (base.startsWith(q)) return 780;
  if (nm.startsWith(q)) return 760;
  if (disp.includes(q)) return 520;
  if (exch.includes(q)) return 500;
  if (base.includes(q)) return 480;
  if (nm.includes(q)) return 460;
  if (quote === q) return 300; // quote-only match ranks low
  return 0;
}

/**
 * Search the registry. Matches exchange format (BTCUSDT), display symbol
 * (BTC/USDT), base asset (BTC) and coin name (Bitcoin). Case-insensitive.
 */
export function searchPairs(
  query: string,
  pairs: RegistryPair[],
  tickers: Map<string, TickerRow> | null,
  limit = 60,
): ScoredPair[] {
  const q = normalizeToExchangeSymbol(query);
  if (!q) return [];
  const alt = query.includes("/")
    ? normalizeToExchangeSymbol(query.split("/")[0])
    : "";
  const results: ScoredPair[] = [];
  for (const pair of pairs) {
    const name = coinName(pair.baseAsset);
    let s = scorePair(pair, q, name);
    if (s === 0 && alt) s = scorePair(pair, alt, name) / 2;
    if (s > 0) {
      results.push({
        pair,
        ticker: tickers?.get(pair.exchangeSymbol) ?? null,
        score: s,
      });
    }
  }
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: prefer major quotes (USDT first), then alphabetical
    const pa = QUOTE_PRIORITY.indexOf(a.pair.quoteAsset);
    const pb = QUOTE_PRIORITY.indexOf(b.pair.quoteAsset);
    const ra = pa === -1 ? QUOTE_PRIORITY.length : pa;
    const rb = pb === -1 ? QUOTE_PRIORITY.length : pb;
    if (ra !== rb) return ra - rb;
    return a.pair.exchangeSymbol.localeCompare(b.pair.exchangeSymbol);
  });
  return results.slice(0, limit);
}
