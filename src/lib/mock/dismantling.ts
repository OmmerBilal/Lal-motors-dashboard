/**
 * Local helpers for the Dismantling Employee workspace only. These do NOT create a
 * second vehicle dataset — the workspace reads/writes the same shared VehicleRecord via
 * useVehicleData(). This file just supplies the mock "AI part identification" labels and
 * review-confidence assignment used to summarize a finished dismantling session, standing
 * in for the real vision/AI pipeline that will run server-side later.
 */

export const dismantlingPartTypes = [
  "Catalytic Converter",
  "Headlight",
  "Taillight",
  "ABS Module",
  "PCM",
  "ECM",
  "BCM",
  "ACM",
  "Airbag",
  "Engine",
  "Transmission",
  "Alternator",
  "Starter",
  "AC Compressor",
  "Mirror",
  "Fender",
  "Door",
  "Bumper",
];

export const highValuePartTypes = new Set([
  "Catalytic Converter",
  "ECM",
  "PCM",
  "BCM",
  "Engine",
  "Transmission",
  "Airbag",
]);

export type PartReviewStatus = "processed" | "needs_review" | "possible_duplicate";

export const partReviewLabels: Record<PartReviewStatus, string> = {
  processed: "Processed",
  needs_review: "Needs Manager Review",
  possible_duplicate: "Possible Duplicate — Manager Review",
};

export type ProcessedPartResult = {
  id: string;
  partType: string;
  reviewStatus: PartReviewStatus;
  capturedAt: string;
};

/** Mock AI part-type guess — cycles through common dismantling part types in capture order. */
export function guessPartType(index: number): string {
  return dismantlingPartTypes[index % dismantlingPartTypes.length];
}

/** Deterministic mock confidence assignment so the demo reliably shows all three outcomes. */
export function guessReviewStatus(index: number): PartReviewStatus {
  const n = index + 1;
  if (n % 7 === 0) return "possible_duplicate";
  if (n % 4 === 0) return "needs_review";
  return "processed";
}

export const issueOptions = [
  "Wrong Vehicle",
  "VIN / Lot / Stock Not Found",
  "Vehicle Mismatch",
  "Photo Problem",
  "Part Problem",
  "Safety Issue",
  "Other",
];

export const processingChecklist = [
  "Matching photos to vehicle",
  "Analyzing parts",
  "Checking duplicates",
  "Creating inventory records",
  "Updating vehicle",
  "Saving employee activity",
];
