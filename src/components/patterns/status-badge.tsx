import { cn } from "cn";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";

const toneClasses: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
  brand: "bg-accent-gold/20 text-accent-gold-foreground",
};

const defaultToneByKeyword: { match: RegExp; tone: StatusTone }[] = [
  { match: /overdue|exception|conflict|error|needs correction|missing|rejected/i, tone: "danger" },
  { match: /needs review|pending|awaiting|in transit|processing|draft/i, tone: "warning" },
  { match: /completed|approved|confirmed|sold|delivered|active|ready|paid|verified/i, tone: "success" },
  { match: /new|assigned|scheduled|dispatched/i, tone: "info" },
];

export function statusTone(status: string): StatusTone {
  const found = defaultToneByKeyword.find((entry) => entry.match.test(status));
  return found?.tone ?? "neutral";
}

export function StatusBadge({
  children,
  tone,
  className,
}: {
  children: string;
  tone?: StatusTone;
  className?: string;
}) {
  const resolved = tone ?? statusTone(children);
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap",
        toneClasses[resolved],
        className
      )}
    >
      {children}
    </span>
  );
}
