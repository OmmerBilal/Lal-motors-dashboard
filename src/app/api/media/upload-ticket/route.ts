import { NextResponse } from "next/server";
import { createUploadTicket, type UploadTicketInput } from "@/lib/media/media-service";
import { httpStatusFor } from "@/lib/media/http";

export async function POST(request: Request) {
  let body: Partial<Record<keyof UploadTicketInput, unknown>>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid", message: "Request body must be JSON." } }, { status: 400 });
  }

  const result = await createUploadTicket({
    ownerType: String(body.ownerType ?? ""),
    ownerId: String(body.ownerId ?? ""),
    clientRequestId: String(body.clientRequestId ?? ""),
    role: body.role == null ? null : String(body.role),
    mimeType: String(body.mimeType ?? ""),
    sizeBytes: Number(body.sizeBytes),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: httpStatusFor(result.error.code) });
  return NextResponse.json(result.data, { status: result.data.alreadyExisted ? 200 : 201 });
}
