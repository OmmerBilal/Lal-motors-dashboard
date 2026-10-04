"use client";

import { Bot } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";

/** The Sales AI Manager belongs to Module 16. Nothing here reads or writes records. */
export function AiView() {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-3 flex items-center gap-2">
        <Bot className="size-5 text-primary" />
        <h3 className="text-sm font-semibold">LAL Sales AI Manager</h3>
      </div>
      <EmptyState icon={Bot} title="Not connected yet" description="The AI assistant is not connected. Sales, quotes and payments work without it." />
    </div>
  );
}
