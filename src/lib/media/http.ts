import type { MediaError } from "@/lib/media/media-service";

export function httpStatusFor(code: MediaError["code"]): number {
  switch (code) {
    case "invalid": return 400;
    case "forbidden": return 403;
    case "not_found": return 404;
    default: return 500;
  }
}
