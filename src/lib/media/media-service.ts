import "server-only";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/log";

/**
 * Media upload / read service. Two clients, two jobs:
 *
 *   userClient  (RLS session of the caller)  -> AUTHORIZATION. Every row insert/select on
 *               media_assets goes through the caller's session, so public.can_access_media()
 *               and public.media_owner_exists() decide, in the database, whether this person
 *               may attach or see a file for this owner. The app never re-implements that rule.
 *
 *   adminClient (service role, server-only)  -> BYTES. Signed upload/read URLs and variant
 *               generation. Only reached AFTER the RLS step above has passed for this caller.
 *
 * Variant generation runs locally with sharp (resize / orient / WebP). No external AI or
 * image API is called, so this path costs nothing per image.
 */

export const OWNER_TYPES = [
  "vehicle", "vehicle_completion", "vehicle_intake_batch", "dismantling_session", "part",
  "customer", "scrap_load", "scrap_payment", "driver_check",
  "rim_obligation", "rim_return", "container", "export_invoice", "export_payment",
] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

const CONFIDENTIAL_OWNER_TYPES: ReadonlySet<OwnerType> = new Set(["export_invoice", "export_payment"]);
const OPERATIONAL_BUCKET = "operational-media";
const CONFIDENTIAL_BUCKET = "confidential-export-media";

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
const MAX_BYTES = 15 * 1024 * 1024;
const SIGNED_READ_SECONDS = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[a-z][a-z0-9_]{0,39}$/;

export type MediaError = { code: "invalid" | "forbidden" | "not_found" | "failed"; message: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: MediaError };

const fail = <T>(code: MediaError["code"], message: string): Result<T> => ({ ok: false, error: { code, message } });

export function bucketFor(ownerType: OwnerType) {
  return CONFIDENTIAL_OWNER_TYPES.has(ownerType) ? CONFIDENTIAL_BUCKET : OPERATIONAL_BUCKET;
}

export type UploadTicketInput = {
  ownerType: string;
  ownerId: string;
  clientRequestId: string;
  role?: string | null;
  mimeType: string;
  sizeBytes: number;
};

export type UploadTicket = {
  mediaId: string;
  bucket: string;
  path: string;
  uploadUrl: string;
  contentType: string;
  alreadyExisted: boolean;
};

function extensionFor(mime: string) {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    case "application/pdf": return "pdf";
    default: return "bin";
  }
}

/**
 * Step 1 of an upload. Creates the original's metadata row through the caller's RLS session
 * (idempotent: the same clientRequestId returns the same row) and hands back a short-lived
 * signed PUT URL. The bytes are not trusted until completeUpload() has inspected them.
 */
export async function createUploadTicket(input: UploadTicketInput): Promise<Result<UploadTicket>> {
  if (!(OWNER_TYPES as readonly string[]).includes(input.ownerType)) return fail("invalid", "Unknown record type.");
  if (!UUID_RE.test(input.ownerId)) return fail("invalid", "Invalid record id.");
  if (!UUID_RE.test(input.clientRequestId)) return fail("invalid", "Invalid upload id.");
  if (input.role != null && !ROLE_RE.test(input.role)) return fail("invalid", "Invalid photo role.");
  const ownerType = input.ownerType as OwnerType;
  const allowedMime: readonly string[] = bucketFor(ownerType) === CONFIDENTIAL_BUCKET
    ? [...IMAGE_MIME, "application/pdf"]
    : IMAGE_MIME;
  if (!allowedMime.includes(input.mimeType)) return fail("invalid", "This file type is not allowed.");
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_BYTES) {
    return fail("invalid", "File is too large (15 MB maximum).");
  }

  const bucket = bucketFor(ownerType);
  const folder = `${ownerType}/${input.ownerId}/${input.clientRequestId}`;
  const path = `${folder}/original.${extensionFor(input.mimeType)}`;

  const user = await createUserClient();
  const { data: auth } = await user.auth.getUser();
  if (!auth.user) return fail("forbidden", "Your session has ended. Sign in again.");

  // Idempotent retry: same client request -> same media row, no duplicate.
  const existing = await user.from("media_assets").select("id, bucket, storage_path, mime_type").eq("bucket", bucket).eq("storage_path", path).maybeSingle();
  if (existing.error) return fail("forbidden", "You do not have access to attach files to this record.");

  let mediaId: string;
  let alreadyExisted = false;
  if (existing.data) {
    mediaId = existing.data.id;
    alreadyExisted = true;
  } else {
    const inserted = await user
      .from("media_assets")
      .insert({
        owner_type: ownerType,
        owner_id: input.ownerId,
        role: input.role ?? null,
        variant: "original",
        bucket,
        storage_path: path,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        status: "processing",
        uploaded_by: auth.user.id,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      // RLS rejects both "not allowed for this role" and "owner record does not exist".
      // Same message for both, so the response does not reveal which record ids exist.
      logEvent("warn", { operation: "media.ticket.denied", actor_id: auth.user.id, owner_type: ownerType });
      return fail("forbidden", "You do not have access to attach files to this record.");
    }
    mediaId = inserted.data.id;
  }

  const admin = createAdminClient();
  const signed = await admin.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
  if (signed.error || !signed.data) {
    logEvent("error", { operation: "media.ticket.sign", actor_id: auth.user.id, entity: mediaId });
    return fail("failed", "Could not prepare the upload. Try again.");
  }

  logEvent("info", { operation: "media.ticket", actor_id: auth.user.id, entity: mediaId, owner_type: ownerType });
  return {
    ok: true,
    data: { mediaId, bucket, path, uploadUrl: signed.data.signedUrl, contentType: input.mimeType, alreadyExisted },
  };
}

export type CompletedMedia = { mediaId: string; variants: { thumbnail?: string; medium?: string }; width: number | null; height: number | null };

/**
 * Step 2, after the bytes are in Storage. Verifies the caller can see the original through RLS,
 * checks the real content (magic bytes via sharp, not the client-declared MIME), writes the
 * medium and thumbnail WebP variants, and records them. Safe to call twice: finished variants
 * are returned as-is.
 */
export async function completeUpload(mediaId: string): Promise<Result<CompletedMedia>> {
  if (!UUID_RE.test(mediaId)) return fail("invalid", "Invalid media id.");

  const user = await createUserClient();
  const { data: original, error } = await user
    .from("media_assets")
    .select("id, owner_type, owner_id, bucket, storage_path, mime_type, status, width, height")
    .eq("id", mediaId)
    .maybeSingle();
  if (error || !original) return fail("not_found", "File not found.");

  const admin = createAdminClient();

  const existingVariants = await user
    .from("media_assets")
    .select("id, variant, storage_path")
    .eq("variant_of", original.id);
  const have = Object.fromEntries((existingVariants.data ?? []).map((v) => [v.variant, v.id]));
  if (original.status === "ready" && have.thumbnail && have.medium) {
    return {
      ok: true,
      data: { mediaId: original.id, variants: { thumbnail: have.thumbnail, medium: have.medium }, width: original.width, height: original.height },
    };
  }

  const { data: blob, error: dlError } = await admin.storage.from(original.bucket).download(original.storage_path);
  if (dlError || !blob) {
    return fail("failed", "The upload did not arrive. Retry the upload.");
  }
  const bytes = Buffer.from(await blob.arrayBuffer());

  // Content check: a file that is not an image is marked failed, never turned into variants.
  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes, { failOn: "error" }).metadata();
  } catch {
    await admin.from("media_assets").update({ status: "failed" }).eq("id", original.id);
    logEvent("warn", { operation: "media.complete.not_image", entity: original.id });
    return fail("invalid", "This file is not a valid image. Retake the photo and try again.");
  }

  const folder = original.storage_path.split("/").slice(0, -1).join("/");
  const variantRows: { variant: "medium" | "thumbnail"; path: string; width: number; height: number; bytes: number }[] = [];
  const pipelines = [
    { variant: "medium" as const, max: 1600, quality: 82 },
    { variant: "thumbnail" as const, max: 400, quality: 75 },
  ];
  for (const p of pipelines) {
    const out = await sharp(bytes).rotate().resize({ width: p.max, height: p.max, fit: "inside", withoutEnlargement: true }).webp({ quality: p.quality }).toBuffer({ resolveWithObject: true });
    const path = `${folder}/${p.variant}.webp`;
    const up = await admin.storage.from(original.bucket).upload(path, out.data, { contentType: "image/webp", upsert: true });
    if (up.error) {
      logEvent("error", { operation: "media.complete.upload_variant", entity: original.id, variant: p.variant });
      return fail("failed", "Could not save the processed photo. Retry.");
    }
    variantRows.push({ variant: p.variant, path, width: out.info.width, height: out.info.height, bytes: out.info.size });
  }

  // Variant rows are written with the service client, AFTER the RLS read above proved the caller
  // may access this owner. The original's status and dimensions also move here, since clients have
  // no update policy on media_assets by design.
  const ids: Partial<Record<"medium" | "thumbnail", string>> = {};
  for (const v of variantRows) {
    const row = await admin
      .from("media_assets")
      .upsert(
        {
          owner_type: original.owner_type,
          owner_id: original.owner_id,
          variant: v.variant,
          variant_of: original.id,
          bucket: original.bucket,
          storage_path: v.path,
          mime_type: "image/webp",
          size_bytes: v.bytes,
          width: v.width,
          height: v.height,
          status: "ready",
        },
        { onConflict: "bucket,storage_path", ignoreDuplicates: false }
      )
      .select("id")
      .single();
    if (row.error || !row.data) return fail("failed", "Could not record the processed photo. Retry.");
    ids[v.variant] = row.data.id;
  }

  await admin
    .from("media_assets")
    .update({ status: "ready", width: meta.width ?? null, height: meta.height ?? null })
    .eq("id", original.id);

  logEvent("info", { operation: "media.complete", entity: original.id, variants: 2 });
  return {
    ok: true,
    data: { mediaId: original.id, variants: ids, width: meta.width ?? null, height: meta.height ?? null },
  };
}

export type ReadVariant = "thumbnail" | "medium" | "original";

/**
 * Short-lived read URL for one variant. Vehicle/part lists should request "thumbnail" only,
 * detail screens "medium", and "original" only on an explicit full-resolution / download action.
 */
export async function getReadUrl(mediaId: string, variant: ReadVariant): Promise<Result<{ url: string; expiresInSeconds: number }>> {
  if (!UUID_RE.test(mediaId)) return fail("invalid", "Invalid media id.");

  const user = await createUserClient();
  const { data: original, error } = await user
    .from("media_assets")
    .select("id, bucket, storage_path, status")
    .eq("id", mediaId)
    .is("variant_of", null)
    .maybeSingle();
  if (error || !original) return fail("not_found", "File not found.");

  let target = original;
  if (variant !== "original") {
    const { data: v, error: vErr } = await user
      .from("media_assets")
      .select("id, bucket, storage_path, status")
      .eq("variant_of", original.id)
      .eq("variant", variant)
      .maybeSingle();
    if (vErr || !v) return fail("not_found", "This size is not available yet.");
    target = v;
  }
  if (target.status !== "ready") return fail("not_found", "This photo is still processing.");

  const admin = createAdminClient();
  const signed = await admin.storage.from(target.bucket).createSignedUrl(target.storage_path, SIGNED_READ_SECONDS);
  if (signed.error || !signed.data) return fail("failed", "Could not open the photo. Try again.");
  return { ok: true, data: { url: signed.data.signedUrl, expiresInSeconds: SIGNED_READ_SECONDS } };
}
