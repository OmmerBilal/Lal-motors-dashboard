import { NextResponse } from "next/server";
import { getThumbnailUrlsForOriginals } from "@/lib/media/media-service";
import { httpStatusFor } from "@/lib/media/http";

/** POST { mediaIds: string[] } -> { urls: { [originalMediaId]: signedThumbnailUrl } }. Caller's RLS decides what is visible. */
export async function POST(request: Request) {
  let body: { mediaIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid", message: "Send a JSON body." } }, { status: 400 });
  }
  const mediaIds = Array.isArray(body.mediaIds) ? body.mediaIds.filter((x): x is string => typeof x === "string") : null;
  if (!mediaIds) return NextResponse.json({ error: { code: "invalid", message: "mediaIds must be a list." } }, { status: 400 });

  const result = await getThumbnailUrlsForOriginals(mediaIds);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: httpStatusFor(result.error.code) });
  return NextResponse.json({ urls: result.data }, { headers: { "Cache-Control": "private, no-store" } });
}
