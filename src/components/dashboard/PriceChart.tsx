import { useEffect, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";

interface PriceChartProps {
  data: number[];
  color?: "green" | "red" | "blue" | "violet";
  height?: number;
  showGrid?: boolean;
  showLabels?: boolean;
  showGradient?: boolean;
  className?: string;
  currentPrice?: number;
  previousPrice?: number;
}

export function PriceChart({
  data,
  color = "green",
  height = 200,
  showGrid = true,
  showLabels = true,
  showGradient = true,
  className,
  currentPrice,
  previousPrice,
}: PriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const colors = useMemo(() => ({
    green: { line: "#10b981", gradient: ["#10b981", "#059669"], fill: "rgba(16, 185, 129, 0.1)" },
    red: { line: "#ef4444", gradient: ["#ef4444", "#dc2626"], fill: "rgba(239, 68, 68, 0.1)" },
    blue: { line: "#3b82f6", gradient: ["#3b82f6", "#2563eb"], fill: "rgba(59, 130, 246, 0.1)" },
    violet: { line: "#8b5cf6", gradient: ["#8b5cf6", "#7c3aed"], fill: "rgba(139, 92, 246, 0.1)" },
  }), []);

  const isPositive = currentPrice && previousPrice ? currentPrice >= previousPrice : true;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size with device pixel ratio for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 60, bottom: 30, left: 10 };

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Calculate price range
    const minPrice = Math.min(...data);
    const maxPrice = Math.max(...data);
    const priceRange = maxPrice - minPrice || 1;
    const pricePadding = priceRange * 0.1;

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Draw grid lines
    if (showGrid) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;

      // Horizontal grid lines
      const gridLines = 5;
      for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (chartHeight / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
      }
    }

    // Draw price labels
    if (showLabels) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "right";

      const labelLines = 5;
      for (let i = 0; i <= labelLines; i++) {
        const y = padding.top + (chartHeight / labelLines) * i;
        const price = maxPrice + pricePadding - ((priceRange + pricePadding * 2) / labelLines) * i;
        
        // Format price based on magnitude
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
    }

    // Calculate points
    const points = data.map((price, i) => ({
      x: padding.left + (i / (data.length - 1)) * chartWidth,
      y: padding.top + chartHeight - ((price - minPrice + pricePadding) / (priceRange + pricePadding * 2)) * chartHeight,
    }));

    // Draw gradient fill
    if (showGradient) {
      const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
      const lineColor = isPositive ? colors.green : colors.red;
      gradient.addColorStop(0, lineColor.fill);
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.beginPath();
      ctx.moveTo(points[0].x, height - padding.bottom);
      
      for (let i = 0; i < points.length; i++) {
        if (i === 0) {
          ctx.lineTo(points[i].x, points[i].y);
        } else {
          // Smooth curve using bezier
          const prevPoint = points[i - 1];
          const cpx = (prevPoint.x + points[i].x) / 2;
          ctx.bezierCurveTo(cpx, prevPoint.y, cpx, points[i].y, points[i].x, points[i].y);
        }
      }
      
      ctx.lineTo(points[points.length - 1].x, height - padding.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Draw line
    const lineColor = isPositive ? colors.green : colors.red;
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

    // Draw current price dot
    if (currentPrice && points.length > 0) {
      const lastPoint = points[points.length - 1];
      
      // Glow effect
      ctx.shadowColor = lineColor.line;
      ctx.shadowBlur = 10;
      
      // Draw dot
      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = lineColor.line;
      ctx.fill();
      
      // Draw pulsing ring
      ctx.strokeStyle = lineColor.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.shadowBlur = 0;
    }
  }, [data, colors, showGrid, showLabels, showGradient, currentPrice, isPositive]);

  return (
    <div className={cn("relative", className)}>
      <canvas
        ref={canvasRef}
        className="w-full"
        style={{ height: `${height}px` }}
      />
      {currentPrice && (
        <div className="absolute top-2 left-2 text-sm font-bold text-white bg-black/50 px-2 py-1 rounded">
          ${currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}
