import { NextResponse } from "next/server";
import { getReadUrl, type ReadVariant } from "@/lib/media/media-service";
import { httpStatusFor } from "@/lib/media/http";

const VARIANTS: readonly ReadVariant[] = ["thumbnail", "medium", "original"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mediaId = searchParams.get("mediaId") ?? "";
  const variant = (searchParams.get("variant") ?? "thumbnail") as ReadVariant;
  if (!VARIANTS.includes(variant)) {
    return NextResponse.json({ error: { code: "invalid", message: "Unknown size." } }, { status: 400 });
  }

  const result = await getReadUrl(mediaId, variant);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: httpStatusFor(result.error.code) });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}
