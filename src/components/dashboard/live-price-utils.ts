export interface CandlePoint {
  time: number;
  close: number;
  volume: number;
}

export interface PricePoint {
  time: number;
  price: number;
  close?: number;
}

export function buildPricePoints(candles: CandlePoint[], currentPrice: number): PricePoint[] {
  if (candles.length === 0) return [];
  const pts: PricePoint[] = candles.map((c) => ({ time: c.time, price: c.close, close: c.close }));
  if (Number.isFinite(currentPrice) && currentPrice > 0) {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.price - currentPrice) > 1e-9) {
      pts.push({ time: Date.now(), price: currentPrice, close: currentPrice });
    }
  }
  return pts;
}

export function getDerivedPrice(candles: CandlePoint[], currentPrice: number): number {
  if (Number.isFinite(currentPrice) && currentPrice > 0) {
    return currentPrice;
  }
  if (candles.length > 0) {
    return candles[candles.length - 1].close ?? candles[candles.length - 1].price;
  }
  return 0;
}
