"use client";

import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const shortcuts: { id: string; label: string; days: number }[] = [
  { id: "today", label: "Today", days: 0 },
  { id: "week", label: "This Week", days: 6 },
  { id: "month", label: "This Month", days: 29 },
];

function formatRange(range: DateRange | undefined) {
  if (!range?.from) return "Select dates";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (!range.to || range.to.getTime() === range.from.getTime()) return range.from.toLocaleDateString("en-US", opts);
  return `${range.from.toLocaleDateString("en-US", opts)} – ${range.to.toLocaleDateString("en-US", opts)}`;
}

export function DateRangePicker({ value, onChange }: { value: DateRange | undefined; onChange: (range: DateRange | undefined) => void }) {
  const [open, setOpen] = useState(false);

  function applyShortcut(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    onChange({ from, to });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <CalendarDays className="size-4" />
            {formatRange(value)}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-3" align="end">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {shortcuts.map((s) => (
            <Button key={s.id} variant="outline" size="sm" onClick={() => applyShortcut(s.days)}>
              {s.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
          defaultMonth={value?.from}
        />
        <div className="mt-2 flex justify-end gap-2 border-t border-border pt-2">
          <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>
            Clear
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
