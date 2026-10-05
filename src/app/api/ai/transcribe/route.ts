import { NextResponse } from "next/server";
import { contextFor } from "@/lib/ai/command";
import { transcribeAudio } from "@/lib/ai/openai";
import { AiProviderError } from "@/lib/ai/provider-errors";
import { MAX_UPLOAD_BYTES, respond } from "@/lib/ai/http";
import { ToolError } from "@/lib/ai/tools";

export const runtime = "nodejs";

/**
 * Voice: one recording is transcribed on the server and returned as text. The text is shown to the user to edit,
 * and only a later explicit submit reaches the Command Center. Nothing is written by transcription.
 */
const AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg", "audio/x-m4a"];
const MANAGEMENT = ["owner", "engineer_admin", "manager", "export_manager"];

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await contextFor();
  } catch (err) {
    if (err instanceof ToolError) return respond({ kind: "error", category: err.category, message: err.message });
    return respond({ kind: "error", category: "unknown", message: "Sign in again." });
  }
  if (!MANAGEMENT.some((r) => ctx.roles.includes(r))) return respond({ kind: "error", category: "forbidden", message: "Your role cannot use voice commands." });
  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_UPLOAD_BYTES || !AUDIO_TYPES.includes(audio.type.split(";")[0])) {
    return respond({ kind: "error", category: "invalid", message: "Record a clip of up to 10 MB." });
  }
  try {
    const text = await transcribeAudio(audio, `clip.${audio.type.includes("mp4") ? "m4a" : "webm"}`);
    return NextResponse.json({ kind: "transcript", text: text.slice(0, 1000) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AiProviderError) return respond({ kind: "error", category: err.category, message: err.message });
    return respond({ kind: "error", category: "unknown", message: "Transcription failed. Type the command instead." });
  }
}
