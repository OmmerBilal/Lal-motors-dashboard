import { NextResponse } from "next/server";
import { completeUpload } from "@/lib/media/media-service";
import { httpStatusFor } from "@/lib/media/http";

export async function POST(request: Request) {
  let body: { mediaId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid", message: "Request body must be JSON." } }, { status: 400 });
  }

  const result = await completeUpload(String(body.mediaId ?? ""));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: httpStatusFor(result.error.code) });
  return NextResponse.json(result.data);
}
