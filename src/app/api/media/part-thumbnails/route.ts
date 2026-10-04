import { NextResponse } from "next/server";
import { getPosPartThumbnailUrls } from "@/lib/media/media-service";
import { httpStatusFor } from "@/lib/media/http";

/** POST { partIds: string[] } -> { urls: { [partId]: signedThumbnailUrl } }. Sales staff, sellable parts only. */
export async function POST(request: Request) {
  let body: { partIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid", message: "Send a JSON body." } }, { status: 400 });
  }
  const partIds = Array.isArray(body.partIds) ? body.partIds.filter((x): x is string => typeof x === "string") : null;
  if (!partIds) return NextResponse.json({ error: { code: "invalid", message: "partIds must be a list." } }, { status: 400 });

  const result = await getPosPartThumbnailUrls(partIds);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: httpStatusFor(result.error.code) });
  return NextResponse.json({ urls: result.data }, { headers: { "Cache-Control": "private, no-store" } });
}
