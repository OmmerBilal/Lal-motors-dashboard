import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import type { StatusTone } from "@/components/patterns/status-badge";

/**
 * Solid, saturated fill per tone — matching reference-images/dashboard reference image.jpeg, where
 * every KPI tile is a confident block of colour with a white icon chip and white text, not a pale
 * tint. "brand" (gold) is the one light tone, so it gets dark text instead of white.
 */
const TONE_SOLID: Record<StatusTone, { card: string; fg: string; chip: string; sub: string; hint: string }> = {
  neutral: { card: "bg-tone-grey", fg: "text-white", chip: "bg-white/20", sub: "text-white/85", hint: "text-white/65" },
  info: { card: "bg-tone-blue", fg: "text-white", chip: "bg-white/20", sub: "text-white/85", hint: "text-white/65" },
  success: { card: "bg-tone-green", fg: "text-white", chip: "bg-white/20", sub: "text-white/85", hint: "text-white/65" },
  warning: { card: "bg-tone-orange", fg: "text-white", chip: "bg-white/20", sub: "text-white/85", hint: "text-white/65" },
  danger: { card: "bg-tone-red", fg: "text-white", chip: "bg-white/20", sub: "text-white/85", hint: "text-white/65" },
  brand: { card: "bg-accent-gold", fg: "text-accent-gold-foreground", chip: "bg-accent-gold-foreground/15", sub: "text-accent-gold-foreground/80", hint: "text-accent-gold-foreground/60" },
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
  /** Which solid colour the whole tile takes. Defaults to "info" (blue) when not given. */
  tone?: StatusTone;
}) {
  const Comp = onClick ? "button" : "div";
  const t = TONE_SOLID[tone];
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg p-3.5 text-left shadow-sm transition-transform",
        t.card,
        t.fg,
        onClick && "cursor-pointer hover:brightness-95",
        active && "ring-2 ring-offset-2 ring-offset-background ring-foreground/40"
      )}
    >
      {Icon && (
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", t.chip)}>
          <Icon className="size-6" strokeWidth={2.25} />
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-2xl leading-none font-semibold tabular-nums">{value}</span>
        <span className={cn("truncate text-xs font-medium", t.sub)}>{label}</span>
        {hint && <span className={cn("truncate text-[11px]", t.hint)}>{hint}</span>}
      </span>
    </Comp>
  );
}
