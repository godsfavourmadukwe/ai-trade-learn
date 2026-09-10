import { useEffect, useRef, useCallback, memo } from "react";
import { cn } from "@/lib/utils";

interface LivePriceChartProps {
  currentPrice: number;
  symbol: string;
  priceHistory?: number[];
  height?: number;
  color?: "green" | "red" | "blue" | "violet";
  className?: string;
  showVolume?: boolean;
}

interface PricePoint {
  time: number;
  price: number;
}

const COLORS = {
  green: { line: "#10b981", fill: "rgba(16, 185, 129, 0.15)" },
  red: { line: "#ef4444", fill: "rgba(239, 68, 68, 0.15)" },
  blue: { line: "#3b82f6", fill: "rgba(59, 130, 246, 0.15)" },
  violet: { line: "#8b5cf6", fill: "rgba(139, 92, 246, 0.15)" },
} as const;

function drawChart(
  canvas: HTMLCanvasElement,
  data: PricePoint[],
  currentPrice: number,
  showVolume: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx || data.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 20, right: 80, bottom: showVolume ? 60 : 30, left: 10 };

  ctx.clearRect(0, 0, width, height);

  // Calculate range
  const prices = data.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;
  const pricePadding = priceRange * 0.1;

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Draw grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const y = padding.top + (chartHeight / 6) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // Time labels
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  const timeLabels = ["-5m", "-4m", "-3m", "-2m", "-1m", "Now"];
  timeLabels.forEach((label, i) => {
    const x = padding.left + (chartWidth / (timeLabels.length - 1)) * i;
    ctx.fillText(label, x, height - 25);
  });

  // Price labels
  ctx.textAlign = "right";
  for (let i = 0; i <= 6; i++) {
    const y = padding.top + (chartHeight / 6) * i;
    const price = maxPrice + pricePadding - ((priceRange + pricePadding * 2) / 6) * i;
    let label: string;
    if (price >= 1000) {
      label = `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    } else if (price >= 1) {
      label = `$${price.toFixed(2)}`;
    } else {
      label = `$${price.toFixed(4)}`;
    }
    ctx.fillText(label, width - 10, y + 3);
  }

  // Calculate points
  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * chartWidth,
    y: padding.top + chartHeight - ((d.price - minPrice + pricePadding) / (priceRange + pricePadding * 2)) * chartHeight,
  }));

  // Determine color based on price direction
  const isPositive = data[data.length - 1].price >= data[0].price;
  const lineColor = isPositive ? COLORS.green : COLORS.red;

  // Draw gradient fill
  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, lineColor.fill);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

  ctx.beginPath();
  ctx.moveTo(points[0].x, height - padding.bottom);
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      ctx.lineTo(points[i].x, points[i].y);
    } else {
      const prevPoint = points[i - 1];
      const cpx = (prevPoint.x + points[i].x) / 2;
      ctx.bezierCurveTo(cpx, prevPoint.y, cpx, points[i].y, points[i].x, points[i].y);
    }
  }
  ctx.lineTo(points[points.length - 1].x, height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw line
  ctx.strokeStyle = lineColor.line;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      ctx.moveTo(points[i].x, points[i].y);
    } else {
      const prevPoint = points[i - 1];
      const cpx = (prevPoint.x + points[i].x) / 2;
      ctx.bezierCurveTo(cpx, prevPoint.y, cpx, points[i].y, points[i].x, points[i].y);
    }
  }
  ctx.stroke();

  // Current price indicator line
  const lastPoint = points[points.length - 1];
  ctx.strokeStyle = lineColor.line;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(width - padding.right, lastPoint.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Current price dot with glow
  ctx.shadowColor = lineColor.line;
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = lineColor.line;
  ctx.fill();

  // Outer ring
  ctx.shadowBlur = 0;
  ctx.strokeStyle = lineColor.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 10, 0, Math.PI * 2);
  ctx.stroke();

  // Price label box
  const priceText =
    currentPrice >= 1000
      ? `$${currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : currentPrice >= 1
        ? `$${currentPrice.toFixed(2)}`
        : `$${currentPrice.toFixed(4)}`;

  ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
  const textWidth = ctx.measureText(priceText).width;
  const boxX = width - padding.right + 5;
  const boxY = lastPoint.y - 12;

  ctx.fillStyle = lineColor.line;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, textWidth + 16, 24, 4);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText(priceText, boxX + 8, lastPoint.y + 4);

  // Draw volume bars
  if (showVolume && data.length > 0) {
    const volumeHeight = 40;
    const volumeY = height - padding.bottom + 5;
    // Use relative volume based on price movement
    for (let i = 0; i < points.length; i++) {
      const x = points[i].x;
      const priceMove = i > 0 ? Math.abs(data[i].price - data[i - 1].price) / data[i].price : 0;
      const barHeight = Math.max(2, priceMove * 500 * volumeHeight);
      ctx.fillStyle = isPositive ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)";
      ctx.fillRect(x - 1, volumeY + volumeHeight - barHeight, 2, barHeight);
    }
  }
}

function LivePriceChartInner({
  currentPrice,
  symbol,
  priceHistory = [],
  height = 300,
  className,
  showVolume = true,
}: LivePriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const priceDataRef = useRef<PricePoint[]>([]);
  const prevPriceRef = useRef<number>(0);
  const animRef = useRef<number>(0);

  // Build initial data from real price history when it arrives
  useEffect(() => {
    if (priceHistory.length === 0) return;

    // Only rebuild if we don't have data yet or symbol changed
    if (priceDataRef.current.length === 0 || prevPriceRef.current === 0) {
      const points: PricePoint[] = priceHistory.map((p, i) => ({
        time: Date.now() - (priceHistory.length - i) * 5000,
        price: p,
      }));
      priceDataRef.current = points;
      prevPriceRef.current = currentPrice;
    }
  }, [priceHistory, currentPrice]);

  // Append new price point when currentPrice changes
  useEffect(() => {
    if (currentPrice <= 0) return;
    if (currentPrice === prevPriceRef.current) return;

    const history = priceDataRef.current;

    // If we have no history yet, seed from currentPrice
    if (history.length === 0) {
      for (let i = 0; i < 60; i++) {
        history.push({
          time: Date.now() - (60 - i) * 5000,
          price: currentPrice,
        });
      }
    }

    history.push({ time: Date.now(), price: currentPrice });

    // Keep last 120 points (~10 minutes at 5s intervals)
    if (history.length > 120) {
      history.shift();
    }

    prevPriceRef.current = currentPrice;
  }, [currentPrice]);

  // Render loop - independent of React renders
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let running = true;
    let lastDraw = 0;
    const fps = 30;
    const interval = 1000 / fps;

    const loop = (ts: number) => {
      if (!running) return;
      if (ts - lastDraw < interval) {
        animRef.current = requestAnimationFrame(loop);
        return;
      }
      lastDraw = ts;

      const data = priceDataRef.current;
      if (data.length >= 2) {
        drawChart(canvas, data, currentPrice, showVolume);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [currentPrice, showVolume]);

  return (
    <div className={cn("relative", className)}>
      <canvas
        ref={canvasRef}
        className="w-full"
        style={{ height: `${height}px` }}
      />
      <div className="absolute top-2 left-2 flex items-center gap-2">
        <div className="px-2 py-1 rounded bg-black/50 backdrop-blur-sm">
          <span className="text-xs text-zinc-400">{symbol}</span>
        </div>
        <div className="px-2 py-1 rounded bg-black/50 backdrop-blur-sm">
          <span className="text-xs text-emerald-400">● Live</span>
        </div>
      </div>
    </div>
  );
}

export const LivePriceChart = memo(LivePriceChartInner);
