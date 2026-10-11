import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import type { StatusTone } from "@/components/patterns/status-badge";

/**
 * Calm, accent-tinted tile per tone — matching every reference-images/*.jpeg KPI card: a pale tint
 * background, a bold tone-coloured number, and a small SOLID icon chip as the one deliberate pop of
 * colour. A fully-saturated solid-fill card (tried in an earlier pass) read as loud/flashy; this is
 * the calmer, more professional version the client's own reference screenshots actually show.
 */
const TONE_TINT: Record<StatusTone, { card: string; value: string; chip: string }> = {
  neutral: { card: "bg-muted/50 border border-border", value: "text-foreground", chip: "bg-muted-foreground text-background" },
  info: { card: "bg-tone-blue/8 border border-tone-blue/20", value: "text-tone-blue", chip: "bg-tone-blue text-white" },
  success: { card: "bg-tone-green/8 border border-tone-green/20", value: "text-tone-green", chip: "bg-tone-green text-white" },
  warning: { card: "bg-tone-orange/10 border border-tone-orange/25", value: "text-tone-orange", chip: "bg-tone-orange text-white" },
  danger: { card: "bg-tone-red/8 border border-tone-red/20", value: "text-tone-red", chip: "bg-tone-red text-white" },
  brand: { card: "bg-accent-gold/10 border border-accent-gold/25", value: "text-accent-gold-foreground", chip: "bg-accent-gold text-accent-gold-foreground" },
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
  /** Which accent the number/icon chip takes. Defaults to "info" (blue) when not given. */
  tone?: StatusTone;
}) {
  const Comp = onClick ? "button" : "div";
  const t = TONE_TINT[tone];
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg p-3.5 text-left shadow-xs transition-colors",
        t.card,
        onClick && "hover:brightness-95",
        active && "ring-2 ring-offset-2 ring-offset-background ring-foreground/30"
      )}
    >
      {Icon && (
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", t.chip)}>
          <Icon className="size-6" strokeWidth={2.25} />
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("text-2xl leading-none font-semibold tabular-nums", t.value)}>{value}</span>
        <span className="truncate text-xs font-medium text-foreground/80">{label}</span>
        {hint && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </Comp>
  );
}
