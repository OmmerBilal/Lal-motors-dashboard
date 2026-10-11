import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import type { StatusTone } from "@/components/patterns/status-badge";

/** Same accent-tinted-chip language as StatusBadge, so a KPI's icon colour always means the same thing as its status pill. */
const TONE_CHIP_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted text-foreground",
  info: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  danger: "bg-destructive/15 text-destructive",
  brand: "bg-accent-gold/20 text-accent-gold-foreground",
};

export function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  onClick,
  active,
  tone = "info",
}: {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  onClick?: () => void;
  active?: boolean;
  /** Which accent the icon chip takes. Defaults to "info" (the brand blue) when not given. */
  tone?: StatusTone;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card p-3.5 text-left shadow-xs transition-colors",
        onClick && "cursor-pointer hover:border-primary/40 hover:bg-accent/40",
        active && "border-primary/50 bg-primary/5"
      )}
    >
      {Icon && (
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", TONE_CHIP_CLASSES[tone])}>
          <Icon className="size-6" strokeWidth={2.25} />
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
