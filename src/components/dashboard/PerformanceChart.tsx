import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PerformanceChartProps {
  title: string;
  data?: number[];
  color?: "green" | "blue" | "red";
  className?: string;
}

export function PerformanceChart({
  title,
  data = [],
  color = "green",
  className,
}: PerformanceChartProps) {
  const maxValue = Math.max(...data, 1);
  const minValue = Math.min(...data, 0);
  const range = maxValue - minValue || 1;

  const colorClasses = {
    green: "from-emerald-500/20 to-emerald-500/5",
    blue: "from-blue-500/20 to-blue-500/5",
    red: "from-red-500/20 to-red-500/5",
  };

  const lineColorClasses = {
    green: "stroke-emerald-500",
    blue: "stroke-blue-500",
    red: "stroke-red-500",
  };

  return (
    <Card className={cn(
      "bg-[#111118] border-white/[0.05]",
      className
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-zinc-400">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {data.length > 0 ? (
          <div className="relative h-32">
            <svg
              viewBox={`0 0 100 30`}
              className="w-full h-full"
              preserveAspectRatio="none"
            >
              {/* Gradient fill */}
              <defs>
                <linearGradient id={`gradient-${color}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={color === "green" ? "#10b981" : color === "blue" ? "#3b82f6" : "#ef4444"} stopOpacity="0.2" />
                  <stop offset="100%" stopColor={color === "green" ? "#10b981" : color === "blue" ? "#3b82f6" : "#ef4444"} stopOpacity="0" />
                </linearGradient>
              </defs>
              
              {/* Area fill */}
              <path
                d={`M 0 ${30 - ((data[0] - minValue) / range) * 30} ${data
                  .map((point, i) => `L ${(i / (data.length - 1)) * 100} ${30 - ((point - minValue) / range) * 30}`)
                  .join(" ")} L 100 30 L 0 30 Z`}
                fill={`url(#gradient-${color})`}
              />
              
              {/* Line */}
              <path
                d={`M 0 ${30 - ((data[0] - minValue) / range) * 30} ${data
                  .map((point, i) => `L ${(i / (data.length - 1)) * 100} ${30 - ((point - minValue) / range) * 30}`)
                  .join(" ")}`}
                fill="none"
                strokeWidth="0.5"
                className={lineColorClasses[color]}
              />
            </svg>
            
            {/* Current value indicator */}
            <div className="absolute right-0 top-0 text-right">
              <span className={cn(
                "text-lg font-bold",
                color === "green" && "text-emerald-400",
                color === "blue" && "text-blue-400",
                color === "red" && "text-red-400"
              )}>
                {data[data.length - 1]?.toFixed(2)}
              </span>
            </div>
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center text-sm text-zinc-500">
            No data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
