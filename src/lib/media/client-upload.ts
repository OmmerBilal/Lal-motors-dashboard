"use client";

/**
 * Browser upload for one photo, using the existing media API:
 *   1. POST /api/media/upload-ticket  -> metadata row + signed PUT URL (idempotent per clientRequestId)
 *   2. PUT the bytes to the signed URL (XHR, so progress events are real)
 *   3. POST /api/media/complete       -> server checks the bytes and creates the variants
 *
 * Retrying with the same clientRequestId is safe. The ticket returns the same row, the PUT
 * overwrites the same object, and complete returns the finished variants without redoing them.
 */

export class MediaUploadError extends Error {
  readonly stage: "ticket" | "transfer" | "complete";
  constructor(message: string, stage: "ticket" | "transfer" | "complete") {
    super(message);
    this.stage = stage;
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function putWithProgress(url: string, file: Blob, contentType: string, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new MediaUploadError("The photo did not transfer. Retry.", "transfer")));
    xhr.onerror = () => reject(new MediaUploadError("Network problem while sending the photo. Retry when you have signal.", "transfer"));
    xhr.send(file);
  });
}

export async function uploadMediaFile(input: {
  ownerType: string;
  ownerId: string;
  role: string;
  file: File;
  clientRequestId: string;
  onProgress: (pct: number) => void;
}): Promise<{ mediaId: string }> {
  const ticketRes = await fetch("/api/media/upload-ticket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      clientRequestId: input.clientRequestId,
      role: input.role,
      mimeType: input.file.type || "image/jpeg",
      sizeBytes: input.file.size,
    }),
  }).catch(() => null);
  if (!ticketRes) throw new MediaUploadError("No connection. Retry when you have signal.", "ticket");
  if (!ticketRes.ok) throw new MediaUploadError(await readError(ticketRes, "The photo could not be prepared. Retry."), "ticket");
  const ticket = (await ticketRes.json()) as { mediaId: string; uploadUrl: string; contentType: string };

  await putWithProgress(ticket.uploadUrl, input.file, ticket.contentType, input.onProgress);

  const doneRes = await fetch("/api/media/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mediaId: ticket.mediaId }),
  }).catch(() => null);
  if (!doneRes) throw new MediaUploadError("No connection while finishing the photo. Retry.", "complete");
  if (!doneRes.ok) throw new MediaUploadError(await readError(doneRes, "The photo could not be processed. Retake it."), "complete");

  return { mediaId: ticket.mediaId };
}
