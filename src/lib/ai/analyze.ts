import "server-only";
import sharp from "sharp";
import { z } from "zod";
import type { ToolContext } from "@/lib/ai/tools";
import { sha256 } from "@/lib/ai/command";
import { callStructured } from "@/lib/ai/openai";
import { AiProviderError } from "@/lib/ai/provider-errors";
import { MAX_UPLOAD_BYTES } from "@/lib/ai/http";
import type { ProgressStage } from "@/lib/ai/progress";

/**
 * Explicit image analysis. Runs only when a person presses Analyze. The image is compressed on the server, hashed,
 * and an identical unchanged image reuses the cached draft. The result is a DRAFT: nothing is written, and an
 * auction screenshot never creates a vehicle by itself. Stages are reported only when they really start.
 */
export type Purpose = "part" | "listing" | "auction_screenshot";

export const PURPOSE_ROLES: Record<Purpose, string[]> = {
  part: ["owner", "engineer_admin", "manager"],
  listing: ["owner", "engineer_admin", "manager"],
  auction_screenshot: ["owner", "engineer_admin", "manager"],
};

const draftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["identity", "category", "title", "description", "specifications", "fitment_suggestion", "seo_title", "seo_description", "tags", "confidence", "uncertainty"],
  properties: {
    identity: { type: "string" },
    category: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    specifications: { type: "array", items: { type: "string" } },
    fitment_suggestion: { type: "string" },
    seo_title: { type: "string" },
    seo_description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    uncertainty: { type: "string" },
  },
};
const auctionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates", "uncertainty"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["vin", "lot_number", "stock_number", "year", "make", "model", "confidence"],
        properties: {
          vin: { type: "string" },
          lot_number: { type: "string" },
          stock_number: { type: "string" },
          year: { type: "integer" },
          make: { type: "string" },
          model: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    uncertainty: { type: "string" },
  },
};

const draftParser = z.object({
  identity: z.string().max(300), category: z.string().max(120), title: z.string().max(200), description: z.string().max(4000),
  specifications: z.array(z.string().max(300)).max(40), fitment_suggestion: z.string().max(1000), seo_title: z.string().max(120),
  seo_description: z.string().max(300), tags: z.array(z.string().max(60)).max(30), confidence: z.number().min(0).max(1), uncertainty: z.string().max(1000),
});
const auctionParser = z.object({
  candidates: z.array(z.object({
    vin: z.string().max(40), lot_number: z.string().max(40), stock_number: z.string().max(40),
    year: z.number().int().min(1900).max(2100), make: z.string().max(60), model: z.string().max(80), confidence: z.number().min(0).max(1),
  })).max(50),
  uncertainty: z.string().max(1000),
});

const PROMPTS: Record<Purpose, string> = {
  part: "You describe one used auto part from a photo for an internal draft. Be cautious: say what is uncertain. Do not invent part numbers.",
  listing: "You write an internal product listing draft for one used auto part from a photo. Draft only; a person reviews it.",
  auction_screenshot: "You read an auction listing screenshot and return candidate vehicle fields only. Use null-like empty strings and 0 when unknown. Never assume a value that is not visible.",
};


export type AnalysisOutcome =
  | { kind: "analysis"; purpose: Purpose; cached: boolean; draftOnly: true; result: unknown }
  | { kind: "error"; category: string; message: string };

type Emit = (stage: ProgressStage) => void;

/** Runs one analysis for a signed-in caller from an uploaded form. Returns a draft or a controlled error. Never writes business data. */
export async function analyzeImage(ctx: ToolContext, form: FormData, emit: Emit = () => {}): Promise<AnalysisOutcome> {
  const purposeParsed = z.enum(["part", "listing", "auction_screenshot"]).safeParse(form.get("purpose"));
  if (!purposeParsed.success) return { kind: "error", category: "invalid", message: "Choose what to analyse." };
  const purpose = purposeParsed.data as Purpose;
  const file = form.get("image");
  if (!(file instanceof File) || !file.type.startsWith("image/") || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return { kind: "error", category: "invalid", message: "Upload one image of up to 10 MB." };
  }
  const known = String(form.get("known") ?? "").slice(0, 1000);
  const reanalyze = form.get("reanalyze") === "true";
  return analyzeBytes(ctx, purpose, Buffer.from(await file.arrayBuffer()), known, reanalyze, emit);
}

/**
 * The analysis itself, from image bytes the server already holds (an uploaded form or a stored part photo).
 * Role check, compression, cache and the bounded provider call are all here, so every AI image path shares them.
 */
export async function analyzeBytes(
  ctx: ToolContext,
  purpose: Purpose,
  raw: Buffer,
  known: string,
  reanalyze: boolean,
  emit: Emit = () => {},
): Promise<AnalysisOutcome> {
  if (!PURPOSE_ROLES[purpose].some((r) => ctx.roles.includes(r))) {
    return { kind: "error", category: "forbidden", message: "Your role cannot run this analysis." };
  }
  emit("preparing_image");
  // Compress before anything else: smaller upload to the provider, and a stable hash for the cache.
  const compressed = await sharp(raw)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
    .catch(() => null);
  if (!compressed) return { kind: "error", category: "invalid", message: "This image could not be read. Try a JPEG or PNG." };
  const hash = sha256(compressed);

  if (!reanalyze) {
    const { data } = await ctx.supabase.rpc("ai_cache_get", { p_purpose: purpose, p_sha256: hash });
    if (data && (data as { result?: unknown }).result) {
      return { kind: "analysis", purpose, cached: true, result: (data as { result: unknown }).result, draftOnly: true };
    }
  }

  const dataUrl = `data:image/jpeg;base64,${compressed.toString("base64")}`;
  try {
    emit("analyzing_image");
    const result = await callStructured({
      system: PROMPTS[purpose],
      user: [
        { type: "text", text: known ? `Known information from the user (use it, do not contradict it): ${known}` : "No other information was given." },
        { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
      ],
      schemaName: purpose === "auction_screenshot" ? "auction_candidates" : "part_draft",
      schema: purpose === "auction_screenshot" ? auctionSchema : draftSchema,
      parse: (raw) => (purpose === "auction_screenshot" ? auctionParser.parse(raw) : draftParser.parse(raw)),
    });
    emit("extracting");
    await ctx.supabase.rpc("ai_cache_put", { p_purpose: purpose, p_sha256: hash, p_model: "configured", p_result: result as object });
    return { kind: "analysis", purpose, cached: false, result, draftOnly: true };
  } catch (err) {
    if (err instanceof AiProviderError) return { kind: "error", category: err.category, message: err.message };
    return { kind: "error", category: "unknown", message: "The analysis failed. Nothing was saved." };
  }
}
