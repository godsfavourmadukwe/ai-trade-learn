import { useEffect, useRef, memo } from "react";
import { cn } from "@/lib/utils";
import type { Candle } from "@/lib/market/types";

export type CandleData = Candle;

interface CandlestickChartProps {
  candles: CandleData[];
  height?: number;
  className?: string;
  symbol?: string;
  interval?: string;
  feedHealth?: "connecting" | "connected" | "reconnecting" | "stale" | "error";
}

function drawCandlestickChart(
  canvas: HTMLCanvasElement,
  candles: CandleData[],
  height: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx || candles.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 16, right: 70, bottom: 50, left: 8 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const volH = 40;
  const priceH = chartH - volH - 8;

  ctx.clearRect(0, 0, w, h);

  // Price range
  const allHigh = Math.max(...candles.map(c => c.high));
  const allLow = Math.min(...candles.map(c => c.low));
  const priceRange = allHigh - allLow || 1;
  const pricePad = priceRange * 0.08;
  const pMin = allLow - pricePad;
  const pMax = allHigh + pricePad;
  const pRange = pMax - pMin;

  // Volume range
  const maxVol = Math.max(...candles.map(c => c.volume), 1);

  const candleCount = candles.length;
  const candleW = Math.max(2, (chartW / candleCount) * 0.7);
  const gap = chartW / candleCount;

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (priceH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  // Price labels
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (priceH / 5) * i;
    const price = pMax - (pRange / 5) * i;
    const label = price >= 1000
      ? `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
      : price >= 1 ? `$${price.toFixed(2)}` : `$${price.toFixed(4)}`;
    ctx.fillText(label, w - 8, y + 4);
  }

  // Time labels
  ctx.textAlign = "center";
  const labelStep = Math.max(1, Math.floor(candleCount / 6));
  for (let i = 0; i < candleCount; i += labelStep) {
    const x = pad.left + i * gap + gap / 2;
    const d = new Date(candles[i].time);
    const timeStr = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    ctx.fillText(timeStr, x, h - 12);
  }

  // Draw candles
  for (let i = 0; i < candleCount; i++) {
    const c = candles[i];
    const x = pad.left + i * gap + gap / 2;
    const isUp = c.close >= c.open;

    const color = isUp ? "#10b981" : "#ef4444";
    const bodyColor = isUp ? "#10b981" : "#ef4444";
    const wickColor = isUp ? "rgba(16,185,129,0.6)" : "rgba(239,68,68,0.6)";

    // Y positions
    const highY = pad.top + ((pMax - c.high) / pRange) * priceH;
    const lowY = pad.top + ((pMax - c.low) / pRange) * priceH;
    const openY = pad.top + ((pMax - c.open) / pRange) * priceH;
    const closeY = pad.top + ((pMax - c.close) / pRange) * priceH;

    // Wick
    ctx.strokeStyle = wickColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    // Body
    const bodyTop = Math.min(openY, closeY);
    const bodyH = Math.max(Math.abs(closeY - openY), 1);
    ctx.fillStyle = bodyColor;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);

    // Volume bar
    const volBarH = (c.volume / maxVol) * volH;
    const volY = pad.top + priceH + 8 + (volH - volBarH);
    ctx.fillStyle = isUp ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)";
    ctx.fillRect(x - candleW / 2, volY, candleW, volBarH);
  }

  // Current price line
  const lastCandle = candles[candles.length - 1];
  const lastY = pad.top + ((pMax - lastCandle.close) / pRange) * priceH;
  const isLastUp = lastCandle.close >= lastCandle.open;
  const lineColor = isLastUp ? "#10b981" : "#ef4444";

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pad.left, lastY);
  ctx.lineTo(w - pad.right, lastY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Current price dot
  ctx.shadowColor = lineColor;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(w - pad.right, lastY, 4, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Price label box
  const priceText = lastCandle.close >= 1000
    ? `$${lastCandle.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : lastCandle.close >= 1
      ? `$${lastCandle.close.toFixed(2)}`
      : `$${lastCandle.close.toFixed(4)}`;
  ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
  const tw = ctx.measureText(priceText).width;
  const bx = w - pad.right + 4;
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.roundRect(bx, lastY - 11, tw + 14, 22, 4);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.fillText(priceText, bx + 7, lastY + 4);
}

function CandlestickChartInner({ candles, height = 350, className, symbol, interval = "1m", feedHealth = "connected" }: CandlestickChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length < 2) return;

    let running = true;
    let lastDraw = 0;
    const drawFrame = (ts: number) => {
      if (!running) return;
      // Throttle to ~30fps while data is flowing; engine emits are already batched.
      if (ts - lastDraw < 33) {
        rafRef.current = requestAnimationFrame(drawFrame);
        return;
      }
      lastDraw = ts;
      drawCandlestickChart(canvas, candles, height);
      rafRef.current = requestAnimationFrame(drawFrame);
    };
    rafRef.current = requestAnimationFrame(drawFrame);

    // Stop the loop shortly after the update settles — the engine emits on data,
    // so a fresh emission restarts the effect. This avoids burning CPU between events.
    const stop = setTimeout(() => { running = false; }, 250);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      clearTimeout(stop);
    };
  }, [candles, height]);

  return (
    <div className={cn("relative", className)}>
      <canvas ref={canvasRef} className="w-full" style={{ height: `${height}px` }} />
      <div className="absolute top-2 left-2 flex items-center gap-2">
        {symbol && (
          <div className="px-2 py-1 rounded bg-black/50 backdrop-blur-sm">
            <span className="text-xs text-zinc-400">{symbol}</span>
          </div>
        )}
        <div className="px-2 py-1 rounded bg-black/50 backdrop-blur-sm">
          <span className={`text-xs ${feedHealth === "connected" ? "text-emerald-400" : feedHealth === "error" ? "text-red-400" : "text-amber-400"}`}>
            ● {feedHealth === "connected" ? "Live" : feedHealth === "error" ? "Offline" : "Reconnecting"}
          </span>
        </div>
      </div>
      {candles.length > 0 && (
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <div className="px-2 py-1 rounded bg-black/50 backdrop-blur-sm flex items-center gap-3 text-[10px]">
            <span className="text-zinc-500">{interval} candles</span>
            <span className="text-emerald-400">▲ Bull</span>
            <span className="text-rose-400">▼ Bear</span>
          </div>
        </div>
      )}
    </div>
  );
}

export const CandlestickChart = memo(CandlestickChartInner);
