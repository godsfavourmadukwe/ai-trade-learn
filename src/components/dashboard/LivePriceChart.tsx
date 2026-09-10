import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface LivePriceChartProps {
  currentPrice: number;
  symbol: string;
  height?: number;
  color?: "green" | "red" | "blue" | "violet";
  className?: string;
  showVolume?: boolean;
}

interface PricePoint {
  time: number;
  price: number;
  volume?: number;
}

export function LivePriceChart({
  currentPrice,
  symbol,
  height = 300,
  color = "green",
  className,
  showVolume = true,
}: LivePriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const priceHistoryRef = useRef<PricePoint[]>([]);
  const prevPriceRef = useRef<number>(currentPrice);
  const animationFrameRef = useRef<number>(0);

  const colors = {
    green: { line: "#10b981", gradient: ["#10b981", "#059669"], fill: "rgba(16, 185, 129, 0.15)" },
    red: { line: "#ef4444", gradient: ["#ef4444", "#dc2626"], fill: "rgba(239, 68, 68, 0.15)" },
    blue: { line: "#3b82f6", gradient: ["#3b82f6", "#2563eb"], fill: "rgba(59, 130, 246, 0.15)" },
    violet: { line: "#8b5cf6", gradient: ["#8b5cf6", "#7c3aed"], fill: "rgba(139, 92, 246, 0.15)" },
  };

  // Initialize with some historical data
  useEffect(() => {
    const initialPoints: PricePoint[] = [];
    let price = currentPrice * 0.98;
    
    for (let i = 0; i < 100; i++) {
      const change = (Math.random() - 0.48) * (currentPrice * 0.005);
      price = Math.max(price + change, currentPrice * 0.95);
      price = Math.min(price, currentPrice * 1.05);
      initialPoints.push({
        time: Date.now() - (100 - i) * 1000,
        price,
        volume: Math.random() * 1000000,
      });
    }
    
    initialPoints.push({
      time: Date.now(),
      price: currentPrice,
      volume: Math.random() * 1000000,
    });
    
    priceHistoryRef.current = initialPoints;
    prevPriceRef.current = currentPrice;
  }, []);

  // Update price when it changes
  useEffect(() => {
    if (currentPrice !== prevPriceRef.current) {
      const history = priceHistoryRef.current;
      
      // Add new point
      history.push({
        time: Date.now(),
        price: currentPrice,
        volume: Math.random() * 1000000,
      });
      
      // Keep last 200 points
      if (history.length > 200) {
        history.shift();
      }
      
      prevPriceRef.current = currentPrice;
    }
  }, [currentPrice]);

  // Smooth animation for price updates
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || priceHistoryRef.current.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastDrawTime = 0;
    const targetFPS = 30;
    const frameInterval = 1000 / targetFPS;

    const draw = (timestamp: number) => {
      if (timestamp - lastDrawTime < frameInterval) {
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }
      lastDrawTime = timestamp;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const padding = { top: 20, right: 80, bottom: showVolume ? 60 : 30, left: 10 };

      // Clear
      ctx.clearRect(0, 0, width, height);

      const data = priceHistoryRef.current;
      if (data.length < 2) {
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      // Calculate range
      const prices = data.map(d => d.price);
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

      // Draw gradient fill
      const isPositive = data[data.length - 1].price >= data[0].price;
      const lineColor = isPositive ? colors.green : colors.red;
      
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
      const priceText = currentPrice >= 1000 
        ? `$${currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : currentPrice >= 1
          ? `$${currentPrice.toFixed(2)}`
          : `$${currentPrice.toFixed(4)}`;
      
      ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
      const textWidth = ctx.measureText(priceText).width;
      const boxX = width - padding.right + 5;
      const boxY = lastPoint.y - 12;
      
      // Price box background
      ctx.fillStyle = lineColor.line;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, textWidth + 16, 24, 4);
      ctx.fill();
      
      // Price text
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.fillText(priceText, boxX + 8, lastPoint.y + 4);

      // Draw volume bars if enabled
      if (showVolume && data.length > 0) {
        const maxVolume = Math.max(...data.map(d => d.volume || 0));
        const volumeHeight = 40;
        const volumeY = height - padding.bottom + 5;
        
        data.forEach((d, i) => {
          const x = padding.left + (i / (data.length - 1)) * chartWidth;
          const barHeight = ((d.volume || 0) / maxVolume) * volumeHeight;
          
          ctx.fillStyle = isPositive ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)";
          ctx.fillRect(x - 1, volumeY + volumeHeight - barHeight, 2, barHeight);
        });
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [currentPrice, colors, showVolume]);

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
