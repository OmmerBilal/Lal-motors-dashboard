"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Mic, Send, Sparkles, Square, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * AI Command Center. Every action here is an explicit person's choice: nothing runs on page load, a typed or
 * transcribed command is only sent on submit, and a write only happens after the person approves its proposal.
 * The server decides what each role may do; this screen only shows what the server returns.
 */

type Failure = { kind: "error"; error: { category: string; message: string } };
type Proposal = { kind: "proposal"; requestId: string; tool: string; preview: { summary: string; target: string; fields: unknown } };
type Read = { kind: "read"; tool: string; data: unknown };
type Answer = { kind: "answer"; text: string };
type CommandReply = Failure | Proposal | Read | Answer;
type HistoryRow = { id: string; tool: string; target_summary: string | null; status: string; error_category: string | null; created_at: string };
type Analysis = {
  kind: "analysis";
  purpose: "part" | "listing" | "auction_screenshot";
  cached: boolean;
  draftOnly: true;
  result: Record<string, unknown>;
};

const PURPOSES: { value: Analysis["purpose"]; label: string }[] = [
  { value: "part", label: "Describe a part" },
  { value: "listing", label: "Draft a listing" },
  { value: "auction_screenshot", label: "Read an auction screenshot" },
];
const ANALYSIS_ROLES = ["owner", "engineer_admin", "manager"];

async function call(url: string, init?: RequestInit): Promise<{ status: number; json: unknown }> {
  try {
    const res = await fetch(url, { ...init, credentials: "same-origin" });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return { status: 0, json: { kind: "error", error: { category: "network", message: "The connection failed. Nothing was changed." } } };
  }
}

function failureText(json: unknown): string {
  const e = (json as Failure | null)?.error;
  return e?.message ?? "The request did not finish. Nothing was changed.";
}

export function AiCommandCenter({ role }: { role: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<CommandReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: ["ai", "history"],
    queryFn: async (): Promise<HistoryRow[]> => {
      const { status, json } = await call("/api/ai/command");
      if (status !== 200) throw new Error(failureText(json));
      return (json as { rows: HistoryRow[] }).rows;
    },
  });
  const history = historyQuery.data ?? [];

  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [purpose, setPurpose] = useState<Analysis["purpose"]>("part");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canAnalyse = ANALYSIS_ROLES.includes(role);

  function loadHistory() {
    queryClient.invalidateQueries({ queryKey: ["ai", "history"] });
  }

  async function send(body: unknown) {
    setBusy(true);
    setError(null);
    setReply(null);
    const { status, json } = await call("/api/ai/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (status !== 200) {
      setError(failureText(json));
      return;
    }
    setReply(json as CommandReply);
    loadHistory();
  }

  function submitText(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (value.length < 3 || busy) return;
    send({ text: value });
  }

  async function startRecording() {
    setVoiceError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceError("This browser cannot record audio. Type the command instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        await transcribe(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setVoiceError("Microphone access was refused. Type the command instead.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  /** The transcript is placed in the box for the person to edit. It is never submitted automatically. */
  async function transcribe(blob: Blob) {
    const form = new FormData();
    form.append("audio", blob, "clip.webm");
    setBusy(true);
    const { json } = await call("/api/ai/transcribe", { method: "POST", body: form });
    setBusy(false);
    const ok = (json as { kind?: string; text?: string } | null)?.kind === "transcript";
    if (ok) setText((json as { text: string }).text);
    else setVoiceError(failureText(json));
  }

  async function decide(requestId: string, decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    const { status, json } = await call("/api/ai/approve", {
      method: decision === "approve" ? "POST" : "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    setBusy(false);
    if (status !== 200) {
      setError(failureText(json));
      loadHistory();
      return;
    }
    setReply(json as CommandReply);
    loadHistory();
  }

  async function analyse(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setAnalysisError("Choose one image first.");
      return;
    }
    setAnalysing(true);
    setAnalysisError(null);
    setAnalysis(null);
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("image", file);
    const { status, json } = await call("/api/ai/analyze", { method: "POST", body: form });
    setAnalysing(false);
    if (status !== 200) {
      setAnalysisError(failureText(json));
      return;
    }
    setAnalysis(json as Analysis);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-brand p-5 text-brand-foreground">
        <p className="text-xs font-semibold tracking-[0.12em] text-accent-gold uppercase">LAL Motors · AI assistant</p>
        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-5 text-accent-gold" /> AI Command Center
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-brand-foreground/70">
          Ask about customers, sales, parts, vehicles and scrap loads. The assistant only uses the tools your role allows, and
          any change is shown to you first and happens only when you approve it.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Command</h3>
            <form onSubmit={submitText} className="space-y-2">
              <label htmlFor="ai-command-text" className="block text-xs text-muted-foreground">
                What would you like to do?
              </label>
              <Textarea
                id="ai-command-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="e.g. Find customer Smith, or show the management summary for this week"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={busy || text.trim().length < 3}>
                  <Send /> Submit
                </Button>
                {recording ? (
                  <Button type="button" variant="destructive" onClick={stopRecording}>
                    <Square /> Stop recording
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={startRecording} disabled={busy}>
                    <Mic /> Record voice
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">A voice clip is placed in the box for you to check before it is sent.</span>
              </div>
            </form>
            {voiceError && <p role="alert" className="mt-2 text-sm text-destructive">{voiceError}</p>}
            {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
          </section>

          <section className="rounded-lg border border-border bg-card p-4" aria-live="polite" aria-busy={busy}>
            <h3 className="mb-2 text-sm font-semibold">Result</h3>
            {busy && <p className="text-sm text-muted-foreground">Working…</p>}
            {!busy && !reply && <p className="text-sm text-muted-foreground">Nothing yet. Submit a command to see its result here.</p>}
            {reply?.kind === "answer" && <p className="text-sm">{reply.text}</p>}
            {reply?.kind === "read" && <ResultData data={reply.data} />}
            {reply?.kind === "proposal" && (
              <div className="space-y-3 rounded-md border border-accent-gold/60 bg-muted/40 p-3">
                <p className="text-sm font-semibold">Proposed change — nothing has been changed yet</p>
                <p className="text-sm">{reply.preview.summary}</p>
                <p className="text-xs text-muted-foreground">Target: {reply.preview.target}</p>
                <FieldList fields={reply.preview.fields} />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => decide(reply.requestId, "approve")} disabled={busy}>
                    <Check /> Approve
                  </Button>
                  <Button type="button" variant="outline" onClick={() => decide(reply.requestId, "reject")} disabled={busy}>
                    <X /> Reject
                  </Button>
                </div>
              </div>
            )}
          </section>

          {canAnalyse && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-1 text-sm font-semibold">Image analysis</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Produces a draft to review. Nothing is saved, and no part, listing or vehicle is created from it.
              </p>
              <form onSubmit={analyse} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                  <div>
                    <label htmlFor="ai-purpose" className="mb-1 block text-xs text-muted-foreground">What is in the picture?</label>
                    <select
                      id="ai-purpose"
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value as Analysis["purpose"])}
                      className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                    >
                      {PURPOSES.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ai-image" className="mb-1 block text-xs text-muted-foreground">Image (up to 10 MB)</label>
                    <input id="ai-image" ref={fileRef} type="file" accept="image/*" className="w-full text-sm" />
                  </div>
                </div>
                <Button type="submit" variant="outline" disabled={analysing}>
                  <Upload /> {analysing ? "Analysing…" : "Analyse image"}
                </Button>
              </form>
              {analysisError && <p role="alert" className="mt-2 text-sm text-destructive">{analysisError}</p>}
              {analysis && <AnalysisDraft analysis={analysis} />}
            </section>
          )}
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Your recent requests</h3>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {history.map((h) => (
                  <li key={h.id} className="min-w-0 py-2">
                    <p className="truncate font-medium">{h.tool.replaceAll("_", " ")}</p>
                    <p className="truncate text-xs text-muted-foreground">{h.target_summary ?? "—"}</p>
                    <p className="text-xs">
                      <span className="capitalize">{h.status}</span>
                      {h.error_category ? ` · ${h.error_category.replaceAll("_", " ")}` : ""} · {new Date(h.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function ResultData({ data }: { data: unknown }) {
  if (Array.isArray(data) && data.length === 0) return <p className="text-sm text-muted-foreground">No matching records.</p>;
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap break-words">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function FieldList({ fields }: { fields: unknown }) {
  const entries = fields && typeof fields === "object" ? Object.entries(fields as Record<string, unknown>) : [];
  if (entries.length === 0) return null;
  return (
    <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground capitalize">{k.replaceAll("_", " ")}</dt>
          <dd className="min-w-0 break-words">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function AnalysisDraft({ analysis }: { analysis: Analysis }) {
  const r = analysis.result;
  const candidates = Array.isArray(r.candidates) ? (r.candidates as Record<string, unknown>[]) : null;
  return (
    <div className="mt-4 space-y-3 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Draft only{analysis.cached ? " · from an earlier identical image" : ""}. Review before you use any of it.
      </p>
      {candidates ? (
        <>
          {candidates.length === 0 ? (
            <p className="text-sm">No vehicle details were readable in this screenshot.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {candidates.map((c, i) => (
                <li key={i} className="rounded-md bg-muted/40 p-2">
                  <p className="font-medium">{[c.year, c.make, c.model].filter(Boolean).join(" ") || "Unknown vehicle"}</p>
                  <p className="text-xs text-muted-foreground">
                    VIN {String(c.vin || "—")} · Lot {String(c.lot_number || "—")} · Stock {String(c.stock_number || "—")} · Confidence {Math.round(Number(c.confidence) * 100)}%
                  </p>
                </li>
              ))}
            </ul>
          )}
          {typeof r.uncertainty === "string" && r.uncertainty && <p className="text-xs text-muted-foreground">Uncertain: {r.uncertainty}</p>}
        </>
      ) : (
        <dl className="grid gap-2 text-sm">
          {Object.entries(r)
            .filter(([k]) => k !== "confidence")
            .map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground capitalize">{k.replaceAll("_", " ")}</dt>
                <dd className="break-words">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
}
