import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "active" | "inactive" | "warning" | "error" | "success";
  label: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const statusClasses = {
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    inactive: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    error: "bg-red-500/10 text-red-400 border-red-500/20",
    success: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  };

  const dotClasses = {
    active: "bg-emerald-500",
    inactive: "bg-zinc-500",
    warning: "bg-amber-500",
    error: "bg-red-500",
    success: "bg-blue-500",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border",
        statusClasses[status],
        className
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", dotClasses[status])} />
      {label}
    </div>
  );
}
