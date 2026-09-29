"use client";

import { useState } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSalesData } from "@/components/sales/sales-data-context";
import { parts as allParts } from "@/lib/mock/parts";

type Message = { role: "user" | "assistant"; content: string; records?: { id: string; label: string; sub: string; kind: "customer" | "part" }[] };

export function AiView() {
  const { customers } = useSalesData();
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<{ customer?: string; part?: string }>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  function respond(query: string): Message {
    const q = query.toLowerCase();
    const phoneMatch = q.match(/[\d()\-\s]{7,}/);
    if (phoneMatch || q.includes("customer")) {
      const digits = (phoneMatch?.[0] || "").replace(/\D/g, "");
      const matches = customers.filter((c) => (digits ? c.phone.replace(/\D/g, "").includes(digits) : `${c.firstName} ${c.lastName} ${c.companyName}`.toLowerCase().includes(q)));
      if (matches.length) {
        return {
          role: "assistant",
          content: `Found ${matches.length} matching customer${matches.length === 1 ? "" : "s"}.`,
          records: matches.slice(0, 5).map((c) => ({ id: c.id, label: c.customerNumber, sub: c.companyName || `${c.firstName} ${c.lastName}`, kind: "customer" })),
        };
      }
      return { role: "assistant", content: "No matching customer found in the real database." };
    }
    const approved = allParts.filter((p) => p.status === "approved");
    const matches = approved.filter((p) =>
      [p.draft.partName, p.draft.title, p.draft.category, p.stockSku].filter(Boolean).some((f) => String(f).toLowerCase().includes(q))
    );
    if (matches.length) {
      return {
        role: "assistant",
        content: `Found ${matches.length} matching part${matches.length === 1 ? "" : "s"}.`,
        records: matches.slice(0, 5).map((p) => ({ id: p.id, label: p.stockSku || "SKU pending", sub: p.draft.partName || p.draft.title || "", kind: "part" })),
      };
    }
    return { role: "assistant", content: "Controlled database actions active. No matching record found — try a different search." };
  }

  function send() {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: value }]);
    window.setTimeout(() => {
      setMessages((m) => [...m, respond(value)]);
      setBusy(false);
    }, 400);
  }

  const selectedCustomer = customers.find((c) => c.id === selected.customer);
  const selectedPart = allParts.find((p) => p.id === selected.part);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Current real-record context</h3>
            <p className="text-xs text-muted-foreground">Context stays linked until New Request</p>
          </div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setSelected({})}>
            <RefreshCw /> New Request
          </Button>
        </div>
        <div className="space-y-2 text-sm">
          <div>
            <small className="block text-xs text-muted-foreground">Customer</small>
            <b>{selectedCustomer ? selectedCustomer.customerNumber : "Not selected"}</b>
          </div>
          <div>
            <small className="block text-xs text-muted-foreground">Part</small>
            <b>{selectedPart ? selectedPart.stockSku : "Not selected"}</b>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Controlled database actions active · No OpenAI API key configured</p>
      </div>

      <div className="flex flex-col rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">LAL Sales AI Manager</h3>
            <p className="text-xs text-muted-foreground">Searches real record IDs. Financial finalization requires human approval.</p>
          </div>
          <Bot className="size-5 text-primary" />
        </div>
        <div className="min-h-[220px] flex-1 space-y-3 overflow-y-auto">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" : "max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm"}>
              <p>{m.content}</p>
              {m.records && (
                <div className="mt-2 space-y-1">
                  {m.records.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelected((s) => (r.kind === "customer" ? { ...s, customer: r.id } : { ...s, part: r.id }))}
                      className="block w-full rounded-md bg-background/60 px-2 py-1.5 text-left text-xs text-foreground hover:bg-background"
                    >
                      <b>{r.label}</b> · {r.sub}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!messages.length && <p className="text-sm text-muted-foreground">Try “Find customer using phone 904-555-1234” or “Find Tesla battery”.</p>}
        </div>
        <div className="mt-3 flex gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Try “Find customer using phone 904-555-1234” or “Find Tesla battery”"
            className="min-h-[44px]"
          />
          <Button disabled={busy || !text.trim()} onClick={send}>
            {busy ? "Working…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
