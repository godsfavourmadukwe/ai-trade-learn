// Build chart-friendly points from candles and an optional live price.
// Returns an alias of CandlePoint so consumers can pass them straight into
// chart code that expects candle-shaped data (including a volume field).
export interface CandlePoint {
  time: number;
  close: number;
  volume: number;
}

export interface PricePoint {
  time: number;
  price: number;
  close?: number;
  volume?: number;
}

export function buildPricePoints(candles: CandlePoint[], currentPrice: number): PricePoint[] {
  if (candles.length === 0) return [];
  if (Number.isFinite(currentPrice) && currentPrice > 0) {
    const lastClose = candles[candles.length - 1].close;
    if (Math.abs(lastClose - currentPrice) > 1e-9) {
      const pts: PricePoint[] = candles.map((c) => ({ time: c.time, price: c.close, close: c.close, volume: c.volume }));
      pts.push({ time: Date.now(), price: currentPrice, close: currentPrice, volume: 0 });
      return pts;
    }
  }
  return candles.map((c) => ({ time: c.time, price: c.close, close: c.close, volume: c.volume }));
}

export function getDerivedPrice(candles: CandlePoint[], currentPrice: number): number {
  if (Number.isFinite(currentPrice) && currentPrice > 0) {
    return currentPrice;
  }
  if (candles.length > 0) {
    return candles[candles.length - 1].close;
  }
  return 0;
}
