"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Mic, Send, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageInput } from "@/components/media/image-input";
import { readProgressStream } from "@/lib/ai/client-stream";
import { PROGRESS_LABELS, SLOW_MESSAGE, SLOW_WARNING_MS, type ProgressEvent } from "@/lib/ai/progress";
import { INTAKE_HANDOFF_KEY } from "@/lib/ai/intake-handoff";

/**
 * AI Command Center. Every stage shown is a real pipeline event from the server (streamed), never a timer.
 * Nothing runs on page load. A write is shown as a proposal first; the provider clock stops while a person decides.
 * Elapsed time is shown only so the user can see the wait; it is not a status.
 */

type Failure = { kind: "error"; error: { category: string; message: string } };
type Proposal = { kind: "proposal"; requestId: string; tool: string; preview: { summary: string; target: string; fields: unknown } };
type Read = { kind: "read"; tool: string; data: unknown };
type Answer = { kind: "answer"; text: string };
type CommandReply = Proposal | Read | Answer;
type HistoryRow = { id: string; tool: string; target_summary: string | null; status: string; error_category: string | null; created_at: string };
type Analysis = { kind: "analysis"; purpose: "part" | "listing" | "auction_screenshot"; cached: boolean; draftOnly: true; result: Record<string, unknown> };

const PURPOSES: { value: Analysis["purpose"]; label: string }[] = [
  { value: "part", label: "Describe a part" },
  { value: "listing", label: "Draft a listing" },
  { value: "auction_screenshot", label: "Read an auction screenshot" },
];
const ANALYSIS_ROLES = ["owner", "engineer_admin", "manager"];

type Phase = "idle" | "running" | "review" | "done" | "failed";
type Track = { phase: Phase; labels: string[]; current: string | null; startedAt: number; elapsedMs: number; error: string | null };
const EMPTY_TRACK: Track = { phase: "idle", labels: [], current: null, startedAt: 0, elapsedMs: 0, error: null };

async function call(url: string, init?: RequestInit): Promise<{ status: number; json: unknown }> {
  try {
    const res = await fetch(url, { ...init, credentials: "same-origin" });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return { status: 0, json: { kind: "error", error: { category: "network", message: "The connection failed. Nothing was changed." } } };
  }
}

export function AiCommandCenter({ role }: { role: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [track, setTrack] = useState<Track>(EMPTY_TRACK);
  const [reply, setReply] = useState<CommandReply | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const historyQuery = useQuery({
    queryKey: ["ai", "history"],
    queryFn: async () => {
      const { status, json } = await call("/api/ai/command");
      if (status !== 200) throw new Error((json as Failure | null)?.error?.message ?? "History could not be loaded.");
      return (json as { rows: HistoryRow[] }).rows;
    },
  });
  const history = historyQuery.data ?? [];

  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [purpose, setPurpose] = useState<Analysis["purpose"]>("part");
  const [image, setImage] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const canAnalyse = ANALYSIS_ROLES.includes(role);

  const running = track.phase === "running";

  // Clock for the running state only. It stops at approval_required, failure, or completion.
  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(tick);
  }, [running]);

  const elapsedMs = running ? Math.max(0, now - track.startedAt) : track.elapsedMs;
  const elapsedSec = Math.floor(elapsedMs / 1000);

  /** Runs one streamed operation and shows only the stages the server reports. */
  async function operate(url: string, body: BodyInit, headers: Record<string, string> | undefined, onDone: (r: Record<string, unknown> & { kind: string }) => void) {
    const startedAt = Date.now();
    setNow(startedAt);
    setTrack({ phase: "running", labels: [], current: null, startedAt, elapsedMs: 0, error: null });
    const outcome = await readProgressStream(url, { body, headers }, (event: ProgressEvent) => {
      if (event.type === "progress") {
        setTrack((t) => ({ ...t, labels: [...t.labels, event.label], current: event.label, phase: event.stage === "approval_required" ? "review" : t.phase, elapsedMs: Date.now() - startedAt }));
      }
    });
    const elapsed = Date.now() - startedAt;
    if (outcome.kind === "error") {
      setTrack((t) => ({ ...t, phase: "failed", current: null, elapsedMs: elapsed, error: outcome.message }));
      return;
    }
    const result = outcome.result;
    setTrack((t) => ({ ...t, phase: result.kind === "proposal" ? "review" : "done", current: null, elapsedMs: elapsed }));
    onDone(result);
  }

  function submitText(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (value.length < 3 || running) return;
    setReply(null);
    operate("/api/ai/command/stream", JSON.stringify({ text: value }), { "content-type": "application/json" }, (r) => {
      setReply(r as unknown as CommandReply);
      queryClient.invalidateQueries({ queryKey: ["ai", "history"] });
      if (r.kind !== "proposal") setText("");
    });
  }

  async function decide(requestId: string, decision: "approve" | "reject") {
    if (decision === "reject") {
      const { status, json } = await call("/api/ai/approve", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      if (status !== 200) setTrack((t) => ({ ...t, phase: "failed", error: (json as Failure).error.message }));
      else {
        setReply(json as CommandReply);
        setTrack({ ...EMPTY_TRACK, phase: "done", labels: [PROGRESS_LABELS.completed] });
      }
      queryClient.invalidateQueries({ queryKey: ["ai", "history"] });
      return;
    }
    setReply(null);
    operate("/api/ai/approve/stream", JSON.stringify({ requestId }), { "content-type": "application/json" }, (r) => {
      setReply(r as unknown as CommandReply);
      queryClient.invalidateQueries({ queryKey: ["ai", "history"] });
    });
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

  /** The transcript goes in the box for the person to edit. It is never submitted automatically. */
  async function transcribe(blob: Blob) {
    const form = new FormData();
    form.append("audio", blob, "clip.webm");
    const { json } = await call("/api/ai/transcribe", { method: "POST", body: form });
    const ok = (json as { kind?: string; text?: string } | null)?.kind === "transcript";
    if (ok) setText((json as { text: string }).text);
    else setVoiceError((json as Failure | null)?.error?.message ?? "Transcription failed. Type the command instead.");
  }

  function analyse(file: File) {
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("image", file);
    setAnalysis(null);
    operate("/api/ai/analyze/stream", form, undefined, (r) => setAnalysis(r as unknown as Analysis));
  }

  /** Hands one candidate to the Module 01 intake review. Nothing is created here; the review still matches and confirms. */
  function reviewCandidate(c: Record<string, unknown>) {
    const sourceText = [c.vin, c.lot_number && `Lot ${c.lot_number}`, c.stock_number && `Stock ${c.stock_number}`, c.year, c.make, c.model]
      .filter((x) => x !== undefined && x !== null && String(x).trim() !== "")
      .join(" ");
    try {
      window.sessionStorage.setItem(INTAKE_HANDOFF_KEY, JSON.stringify({ method: "single", sourceText }));
    } catch {
      /* private mode: the intake page can still be opened and the text pasted */
    }
    router.push("/vehicles");
  }

  const slow = running && elapsedMs >= SLOW_WARNING_MS;
  const busy = running;

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-brand p-5 text-brand-foreground">
        <p className="text-xs font-semibold tracking-[0.12em] text-accent-gold uppercase">LAL Motors · AI assistant</p>
        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-5 text-accent-gold" /> AI Command Center
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-brand-foreground/70">
          Ask about customers, sales, parts, vehicles and scrap loads. Changes are shown to you first and happen only when you approve.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Command</h3>
            <form onSubmit={submitText} className="space-y-2">
              <label htmlFor="ai-command-text" className="block text-xs text-muted-foreground">What would you like to do?</label>
              <Textarea
                id="ai-command-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
                rows={3}
                disabled={busy}
                placeholder="e.g. Find customer Smith, or show the management summary for this week"
              />
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <Button type="submit" className="min-h-11" disabled={busy || text.trim().length < 3}>
                  <Send /> Submit
                </Button>
                {recording ? (
                  <Button type="button" variant="destructive" className="min-h-11" onClick={stopRecording}>
                    <Square /> Stop recording
                  </Button>
                ) : (
                  <Button type="button" variant="outline" className="min-h-11" onClick={startRecording} disabled={busy}>
                    <Mic /> Record voice
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">A voice clip is placed in the box for you to check before it is sent.</span>
              </div>
            </form>
            {voiceError && <p role="alert" className="mt-2 text-sm text-destructive">{voiceError}</p>}
          </section>

          <ProgressPanel track={track} elapsedSec={elapsedSec} slow={slow} />

          {reply?.kind === "answer" && (
            <section className="rounded-lg border border-border bg-card p-4" aria-live="polite">
              <p className="text-sm">{reply.text}</p>
            </section>
          )}
          {reply?.kind === "read" && (
            <section className="rounded-lg border border-border bg-card p-4" aria-live="polite">
              <h3 className="mb-2 text-sm font-semibold">Result</h3>
              <ResultData data={reply.data} />
            </section>
          )}
          {reply?.kind === "proposal" && (
            <section className="space-y-3 rounded-lg border border-accent-gold/60 bg-card p-4" aria-live="polite">
              <p className="text-sm font-semibold">Review required — nothing has changed yet</p>
              <p className="text-sm">{reply.preview.summary}</p>
              <p className="text-xs text-muted-foreground">Target: {reply.preview.target}</p>
              <FieldList fields={reply.preview.fields} />
              <p className="text-xs text-muted-foreground">Approving applies this change once. Cancel discards the proposal.</p>
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <Button type="button" className="min-h-11" onClick={() => decide(reply.requestId, "approve")} disabled={busy}>
                  <Check /> Approve
                </Button>
                <Button type="button" variant="outline" className="min-h-11" onClick={() => decide(reply.requestId, "reject")} disabled={busy}>
                  <X /> Cancel
                </Button>
              </div>
            </section>
          )}

          {canAnalyse && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-1 text-sm font-semibold">Image analysis</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Produces a draft to review. Nothing is saved, and no part, listing or vehicle is created from it.
              </p>
              <div className="space-y-3">
                <div>
                  <label htmlFor="ai-purpose" className="mb-1 block text-xs text-muted-foreground">What is in the picture?</label>
                  <select
                    id="ai-purpose"
                    value={purpose}
                    disabled={busy}
                    onChange={(e) => setPurpose(e.target.value as Analysis["purpose"])}
                    className="h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  >
                    {PURPOSES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <ImageInput
                  label="Photo or screenshot (up to 10 MB)"
                  onChange={setImage}
                  onUse={(file) => analyse(file)}
                  useLabel={busy ? "Analysing…" : "Analyse this image"}
                  disabled={busy}
                />
                {image && !busy && <p className="text-xs text-muted-foreground">Selected: {image.name}</p>}
              </div>
              {analysis && <AnalysisDraft analysis={analysis} onReview={reviewCandidate} />}
            </section>
          )}
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Your recent requests</h3>
            {historyQuery.isError && <p role="alert" className="text-sm text-destructive">History could not be loaded.</p>}
            {history.length === 0 && !historyQuery.isError ? (
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

/** Shows only the stages the server reported, the current one, and the failure state. No fake cycling. */
function ProgressPanel({ track, elapsedSec, slow }: { track: Track; elapsedSec: number; slow: boolean }) {
  if (track.phase === "idle") return null;
  const headline =
    track.phase === "running" ? track.current ?? PROGRESS_LABELS.understanding :
    track.phase === "review" ? PROGRESS_LABELS.approval_required :
    track.phase === "failed" ? "Stopped" : PROGRESS_LABELS.completed;
  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-live="polite" aria-busy={track.phase === "running"}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{headline}</p>
        {track.phase === "running" && <span className="text-xs text-muted-foreground tabular-nums">{elapsedSec}s</span>}
      </div>
      {slow && track.phase === "running" && <p className="mt-1 text-xs text-warning-foreground">{SLOW_MESSAGE}</p>}
      {track.labels.length > 0 && (
        <ol className="mt-3 space-y-1 text-xs text-muted-foreground">
          {track.labels.map((l, i) => (
            <li key={`${i}-${l}`} className="flex items-center gap-2">
              <Check className="size-3.5 shrink-0 text-success" /> {l}
            </li>
          ))}
        </ol>
      )}
      {track.phase === "failed" && track.error && (
        <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{track.error}</p>
      )}
    </section>
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

function AnalysisDraft({ analysis, onReview }: { analysis: Analysis; onReview: (c: Record<string, unknown>) => void }) {
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
                <li key={i} className="rounded-md bg-muted/40 p-3">
                  <p className="font-medium">{[c.year, c.make, c.model].filter(Boolean).join(" ") || "Unknown vehicle"}</p>
                  <p className="text-xs text-muted-foreground">
                    VIN {String(c.vin || "—")} · Lot {String(c.lot_number || "—")} · Stock {String(c.stock_number || "—")} · Confidence {Math.round(Number(c.confidence) * 100)}%
                  </p>
                  <Button size="sm" variant="outline" className="mt-2 min-h-11" onClick={() => onReview(c)}>
                    Review in vehicle intake
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {typeof r.uncertainty === "string" && r.uncertainty && <p className="text-xs text-muted-foreground">Uncertain: {r.uncertainty}</p>}
          <p className="text-xs text-muted-foreground">Review in vehicle intake matches against existing records and asks you to confirm. Nothing is created here.</p>
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
