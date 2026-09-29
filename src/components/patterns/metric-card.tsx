import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

export function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  onClick,
  active,
}: {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-xs transition-colors",
        onClick && "cursor-pointer hover:border-primary/40 hover:bg-accent/40",
        active && "border-primary/50 bg-primary/5"
      )}
    >
      {Icon && (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
          <Icon className="size-5" />
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-2xl leading-none font-semibold tabular-nums">{value}</span>
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        {hint && <span className="truncate text-[11px] text-muted-foreground/70">{hint}</span>}
      </span>
    </Comp>
  );
}
