// Throwaway end-to-end smoke test against the live exchange (run with bun).
import {
  fetchRegistry, searchPairs, fetchTickerFor, fetchOrderBookTop, fetchPairCandles,
  exchangeToDisplay,
} from "../src/lib/market/registry";
import { analyzePair, evaluateThesis } from "../src/lib/market/pair-analysis";

async function main() {
  // 1. Universal registry discovery
  const registry = await fetchRegistry();
  console.log(`[1] registry discovered: ${registry.length} pairs`);
  const quotes = new Set(registry.map((p) => p.quoteAsset));
  console.log(`    quote assets:`, [...quotes].join(", "));

  // 2. Search formats
  for (const q of ["BTCUSDT", "btc/usdt", "Bitcoin", "ETH", "sol", "Cardano", "ZZZZ"]) {
    const r = searchPairs(q, registry, null, 5);
    console.log(`[2] search "${q}" → ${r.length} hits, top: ${r.slice(0, 3).map((x) => x.pair.symbol).join(" | ") || "NONE"}`);
  }

  // 3. Full data + analysis flow for required + extra pairs (incl. non-USDT quote)
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "LINKBTC", "PEPEUSDT"];
  for (const exch of symbols) {
    const found = registry.find((p) => p.exchangeSymbol === exch);
    if (!found) {
      console.log(`[3] ${exch}: NOT IN REGISTRY (skip)`);
      continue;
    }
    const t = await fetchTickerFor(exch);
    const book = await fetchOrderBookTop(exch);
    const candles = await fetchPairCandles(exch, "1m", 300);
    const a = analyzePair({
      symbol: found.symbol, exchangeSymbol: exch, exchange: "binance",
      candles, livePrice: t?.price ?? null,
      ticker: t ? { change24hPercent: t.change24hPercent, high24h: t.high24h, low24h: t.low24h, quoteVolume24h: t.quoteVolume24h } : null,
      orderBook: book, now: Date.now(),
    });
    const th = evaluateThesis("BTC is breaking resistance and I expect continuation", a);
    console.log(
      `[3] ${found.symbol}: price=${t?.price ?? "n/a"} chg24h=${t?.change24hPercent?.toFixed(2) ?? "n/a"}% ` +
      `candles=${candles.length} regime=${a.regime} ok=${a.dataHealth.ok} thesis=${th.verdict}(${th.agreementScore}%)`,
    );
  }

  // 4. Invalid pair → must NOT be in registry, ticker must fail gracefully
  const invalid = registry.find((p) => p.exchangeSymbol === "FAKEUSDT");
  const badTicker = await fetchTickerFor("FAKEUSDT");
  console.log(`[4] invalid pair: registry=${invalid ? "FOUND(BAD)" : "absent(correct)"}, ticker=${badTicker === null ? "null (graceful)" : badTicker?.price}`);

  // 5. display-format round trip sanity
  console.log(`[5] BTCUSDT → ${exchangeToDisplay("BTCUSDT")}, PEPEUSDT → ${exchangeToDisplay("PEPEUSDT")}`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("SMOKE FAILED:", e); process.exit(1); },
);
