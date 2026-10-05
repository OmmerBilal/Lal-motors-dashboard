/**
 * Execution-status events for the AI Command Center. Shared by server and browser (no secrets, no server imports).
 * Each stage is emitted by the pipeline when that step really starts. The labels are fixed strings. Model reasoning
 * is never sent, shown or stored; only these status events are.
 */
export const PROGRESS_LABELS = {
  understanding: "Understanding command…",
  reading_context: "Reading the requested record…",
  preparing_image: "Preparing image…",
  analyzing_image: "Analyzing image…",
  extracting: "Extracting details…",
  preparing_action: "Preparing action…",
  approval_required: "Review required — nothing is applied until you approve",
  checking_state: "Checking current record state…",
  executing: "Applying approved action…",
  saving: "Saving changes…",
  completed: "Completed",
} as const;

export type ProgressStage = keyof typeof PROGRESS_LABELS;

export type ProgressEvent =
  | { type: "progress"; stage: ProgressStage; label: string }
  | { type: "result"; result: unknown }
  | { type: "error"; category: string; message: string };

/** Ceiling for one user-facing AI operation. Matches the provider deadline plus room for the database work. */
export const OPERATION_CEILING_MS = 30_000;
/** Shown to the user as a truthful wait notice, not as a fake stage. */
export const SLOW_WARNING_MS = 20_000;

export const SLOW_MESSAGE = "Still working — waiting for the AI service…";
export const TIMEOUT_MESSAGE = "AI took too long to respond. Your action was not applied. Try again.";
