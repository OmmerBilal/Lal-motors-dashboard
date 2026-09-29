"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CarFront, ClipboardList, Search, Send, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { answerOwnerAi, ownerAiExamples, type AiAnswer, type AiResultRow } from "@/lib/mock/owner-ai";

type HistoryEntry = { id: string; prompt: string; answer: string };

const kindIcon = { vehicle: CarFront, part: ClipboardList, customer: Users, activity: Sparkles };

export function OwnerAiCommandCenter() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  function openRow(row: AiResultRow) {
    if (row.kind === "vehicle") router.push(`/vehicles?open=${row.id}`);
    else if (row.kind === "part") router.push(`/parts?open=${row.id}`);
    else if (row.kind === "customer") router.push(`/sales?open=${row.id}`);
    else router.push("/vehicles");
  }

  function ask(value = prompt) {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    setPrompt(text);
    window.setTimeout(() => {
      const result = answerOwnerAi(text);
      setAnswer(result);
      setHistory((h) => [{ id: `h-${Date.now()}`, prompt: text, answer: result.answer }, ...h].slice(0, 15));
      setPrompt("");
      setBusy(false);
    }, 350);
  }

  return (
    <div>
      <div className="mb-5 rounded-lg bg-brand p-5 text-brand-foreground">
        <p className="text-xs font-semibold tracking-[0.12em] text-accent-gold uppercase">Owner · Connected to LAL Motors</p>
        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-5 text-accent-gold" /> AI Command Center
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-brand-foreground/70">
          Ask about vehicles, parts, customers, employee work, and high-value custody. Answers come from current LAL Motors records.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Ask LAL AI</h3>
            <label htmlFor="owner-ai-prompt" className="mb-1.5 block text-xs text-muted-foreground">
              What would you like to find?
            </label>
            <div className="flex gap-2">
              <Textarea
                id="owner-ai-prompt"
                rows={3}
                maxLength={700}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    ask();
                  }
                }}
                placeholder="Show vehicles over 40 days, or ask what an employee did today…"
              />
              <Button disabled={busy || !prompt.trim()} onClick={() => ask()} className="h-auto">
                <Send /> {busy ? "Checking records…" : "Ask AI"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Questions are logged under your account. Inventory, sales, and approvals stay in their existing workflows.
            </p>
          </div>

          {answer && (
            <div className="rounded-lg border border-border bg-card p-4" aria-live="polite">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Result</h3>
                <small className="text-xs text-muted-foreground">Live records · {answer.model}</small>
              </div>
              <p className="text-sm">{answer.answer}</p>
              {answer.results.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {answer.results.map((row, i) => {
                    const Icon = kindIcon[row.kind];
                    return (
                      <button
                        key={`${row.kind}-${row.id}-${i}`}
                        onClick={() => openRow(row)}
                        className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-accent/30"
                      >
                        <Icon className="size-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-sm">{row.title}</b>
                          <small className="text-xs text-muted-foreground">{row.detail}</small>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Search className="size-4" /> Try a question
            </h3>
            <div className="space-y-1">
              {ownerAiExamples.map((x) => (
                <button
                  key={x}
                  disabled={busy}
                  onClick={() => ask(x)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent/40 disabled:opacity-50"
                >
                  {x} <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Recent questions</h3>
            {history.length ? (
              <div className="space-y-1">
                {history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setPrompt(h.prompt);
                      setAnswer(null);
                    }}
                    className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-accent/40"
                  >
                    <b className="block text-sm">{h.prompt}</b>
                    <small className="text-xs text-muted-foreground">{h.answer}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Your questions will appear here.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
