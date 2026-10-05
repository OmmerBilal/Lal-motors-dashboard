/**
 * Part-category labels and buckets used by the dismantling manager screens. Pure functions and constants only:
 * no records, no seed data, no persistence.
 */

// --- Part-category bucketing (compact "Total Parts Pulled" widget) ---------------------

export type CategoryBucket = "Headlights" | "Converters" | "Modules" | "Bumpers" | "Other";

export const categoryBucketOrder: CategoryBucket[] = ["Headlights", "Converters", "Modules", "Bumpers", "Other"];

export const categoryBucketLabels: Record<CategoryBucket, string> = {
  Headlights: "Headlights",
  Converters: "Converters",
  Modules: "Modules (ECU/PCM)",
  Bumpers: "Bumpers",
  Other: "Other",
};

const bucketByPartType: Record<string, CategoryBucket> = {
  Headlight: "Headlights",
  Taillight: "Headlights",
  Mirror: "Headlights",
  "Catalytic Converter": "Converters",
  "ABS Module": "Modules",
  PCM: "Modules",
  ECM: "Modules",
  BCM: "Modules",
  ACM: "Modules",
  Bumper: "Bumpers",
  Fender: "Bumpers",
  Door: "Bumpers",
  Airbag: "Other",
  Engine: "Other",
  Transmission: "Other",
  Alternator: "Other",
  Starter: "Other",
  "AC Compressor": "Other",
};

export function categoryBucket(partType: string): CategoryBucket {
  return bucketByPartType[partType] ?? "Other";
}

// --- Fuller category labels for the "Parts Summary" tab ---------------------------------

export const detailedCategoryLabels: Record<string, string> = {
  "Catalytic Converter": "Catalytic Converters",
  Headlight: "Headlights",
  Taillight: "Taillights",
  "ABS Module": "ABS",
  PCM: "PCM",
  ECM: "ECM",
  BCM: "BCM",
  ACM: "ACM",
  Airbag: "Airbags",
  Engine: "Engines",
  Transmission: "Transmissions",
  Alternator: "Alternators",
  Starter: "Starters",
  "AC Compressor": "AC Compressors",
  Mirror: "Mirrors",
  Fender: "Fenders",
  Door: "Doors",
  Bumper: "Bumpers",
};

export function detailedCategoryLabel(partType: string): string {
  return detailedCategoryLabels[partType] ?? "Other";
}

// --- Review-action vocabulary (manager actions on a flagged captured part) --------------

export const rejectReasons = ["Not Inventory", "Damaged / Not Usable", "Duplicate Photo", "Other"] as const;
