import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  className?: string;
}

export function MetricCard({
  label,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn(
      "bg-[#111118] border-white/[0.05] hover:border-white/[0.08] transition-colors",
      className
    )}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <span className="text-sm text-zinc-400 font-medium">{label}</span>
          {Icon && (
            <Icon className="w-4 h-4 text-zinc-500" />
          )}
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
            {subtitle && (
              <div className="text-xs text-zinc-500 mt-1">{subtitle}</div>
            )}
          </div>
          {trend && trendValue && (
            <div className={cn(
              "text-xs font-medium px-2 py-1 rounded-full",
              trend === "up" && "bg-emerald-500/10 text-emerald-400",
              trend === "down" && "bg-red-500/10 text-red-400",
              trend === "neutral" && "bg-zinc-500/10 text-zinc-400"
            )}>
              {trend === "up" && "↑"}
              {trend === "down" && "↓"}
              {trend === "neutral" && "→"}
              {" "}
              {trendValue}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
