import "server-only";

/**
 * Structured server log, one JSON object per line. Callers pass identifiers and categories only.
 * Never pass passwords, tokens, keys, connection strings, signed URLs or invoice contents here.
 */
type Level = "info" | "warn" | "error";

export type LogFields = {
  operation: string;
  request_id?: string;
  actor_id?: string;
  entity?: string;
  owner_type?: string;
  variant?: string;
  variants?: number;
  duration_ms?: number;
  error_category?: string;
};

export function logEvent(level: Level, fields: LogFields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
