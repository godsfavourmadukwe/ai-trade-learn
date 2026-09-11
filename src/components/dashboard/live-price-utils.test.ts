import { describe, it, expect } from "vitest";
import { getDerivedPrice, buildPricePoints, type CandlePoint, type PricePoint } from "@/components/dashboard/live-price-utils";

describe("live-price-utils", () => {
  const sampleCandle: CandlePoint = { time: 100, close: 10, volume: 1 };

  it("returns the explicit currentPrice when it is finite and positive", () => {
    const pts = buildPricePoints([sampleCandle], 20);
    expect(getDerivedPrice(pts, 20)).toBe(20);
  });

  it("falls back to the last candle close when currentPrice is 0", () => {
    const pts = buildPricePoints([sampleCandle], 0);
    expect(getDerivedPrice(pts, 0)).toBe(10);
  });

  it("falls back to the last candle close when currentPrice is NaN", () => {
    const pts = buildPricePoints([sampleCandle], NaN);
    expect(getDerivedPrice(pts, NaN)).toBe(10);
  });

  it("falls back to last candle close when currentPrice is negative", () => {
    const pts = buildPricePoints([sampleCandle], -5);
    expect(getDerivedPrice(pts, -5)).toBe(10);
  });

  it("returns 0 when there are no candles and currentPrice is empty", () => {
    const pts = buildPricePoints([] as CandlePoint[], 0);
    expect(getDerivedPrice(pts, 0)).toBe(0);
  });

  it("returns currentPrice when there are no candles but currentPrice is valid", () => {
    const pts = buildPricePoints([] as CandlePoint[], 42);
    expect(getDerivedPrice(pts, 42)).toBe(42);
  });

  it("adds a live point when currentPrice differs from last candle close", () => {
    const pts = buildPricePoints([sampleCandle], 15);
    expect(pts.length).toBe(2);
    const last = pts[pts.length - 1];
    expect(last.price).toBe(15);
    expect(last.close).toBe(15);
    expect(Number.isInteger(last.time)).toBe(true);
  });

  it("does not add a duplicate live point when currentPrice equals last candle close", () => {
    const pts = buildPricePoints([sampleCandle], 10);
    expect(pts.length).toBe(1);
    expect(pts[0].price).toBe(10);
    expect(pts[0].close).toBe(10);
  });

  it("clears points when candles are empty", () => {
    const pts = buildPricePoints([sampleCandle], 5);
    expect(pts.length).toBeGreaterThan(0);
    const cleared = buildPricePoints([] as CandlePoint[], 5);
    expect((cleared as PricePoint[]).length).toBe(0);
  });

  it("preserves close from candles when building points", () => {
    const pts = buildPricePoints([sampleCandle], 0);
    expect(pts[0].close).toBe(10);
    expect(pts[0].price).toBe(10);
  });
});
