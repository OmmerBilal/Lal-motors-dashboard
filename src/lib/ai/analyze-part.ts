import "server-only";
import { z } from "zod";
import type { ToolContext } from "@/lib/ai/tools";
import { analyzeBytes, PURPOSE_ROLES, type AnalysisOutcome } from "@/lib/ai/analyze";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProgressStage } from "@/lib/ai/progress";

/**
 * Module 05 "Analyze Part": a manager asks for an advisory draft of a part that is awaiting review, using the photo
 * already captured for it. The photo is read through the caller's own row policy (the part must be visible to them),
 * then the bytes are fetched server-side and passed to the Module 16 pipeline (role check, compression, cache, bounded
 * provider call). The result is a draft only. Nothing here changes the part: approval is a separate, explicit action.
 */

const REVIEW_STATUSES = ["captured", "draft_ready", "manager_review"];
const partId = z.uuid();

export async function analyzePart(ctx: ToolContext, rawPartId: string, emit: (s: ProgressStage) => void = () => {}): Promise<AnalysisOutcome> {
  if (!PURPOSE_ROLES.part.some((r) => ctx.roles.includes(r))) {
    return { kind: "error", category: "forbidden", message: "Only a manager or admin can analyse a part." };
  }
  const parsed = partId.safeParse(rawPartId);
  if (!parsed.success) return { kind: "error", category: "invalid", message: "Choose a part to analyse." };

  emit("reading_context");
  const { data: part, error: partError } = await ctx.supabase
    .from("parts")
    .select("id, status")
    .eq("id", parsed.data)
    .maybeSingle();
  if (partError) return { kind: "error", category: "forbidden", message: "This part could not be read for your role." };
  if (!part) return { kind: "error", category: "invalid", message: "Part not found." };
  if (!REVIEW_STATUSES.includes(part.status)) {
    return { kind: "error", category: "invalid", message: "Only a part awaiting review can be analysed. Nothing was changed." };
  }

  const { data: media, error: mediaError } = await ctx.supabase
    .from("media_assets")
    .select("id, bucket, storage_path, mime_type")
    .eq("owner_type", "part")
    .eq("owner_id", part.id)
    .eq("variant", "original")
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(1);
  if (mediaError) return { kind: "error", category: "forbidden", message: "The part photo could not be read for your role." };
  const photo = media?.[0];
  if (!photo) return { kind: "error", category: "invalid", message: "This part has no photo to analyse. Add a photo first." };

  // The bytes are fetched on the server with the service client, after the caller's access to the part was proven above.
  const admin = createAdminClient();
  const { data: blob, error: downloadError } = await admin.storage.from(photo.bucket).download(photo.storage_path);
  if (downloadError || !blob) return { kind: "error", category: "unknown", message: "The part photo could not be opened. Nothing was changed." };

  return analyzeBytes(ctx, "part", Buffer.from(await blob.arrayBuffer()), "", false, emit);
}
