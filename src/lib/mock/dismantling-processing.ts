/**
 * Manager-facing "Vehicle Dismantling Processing" module. This file supplies:
 *  - part-category bucketing helpers shared by the employee detail / vehicle detail views
 *  - a seed roster + today's dismantling activity, merged into the SAME shared
 *    vehicles/vehicleEvents arrays in vehicles.ts (see the spread at the bottom of that
 *    file) rather than a second, parallel dataset.
 *
 * The seed vehicles/events below are written using the exact same action shapes
 * (START / PART_REMOVED / STATUS) that the real Employee Dismantling workspace
 * (components/dismantling/dismantling-workspace.tsx) writes, so the manager module's
 * derivation logic works identically whether it's reading seed data or a live session.
 */
import type { VehicleRecord, VehicleEvent } from "@/lib/mock/vehicles";
import { dismantlingPartTypes, highValuePartTypes, guessPartType } from "@/lib/mock/dismantling";

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

export function suggestedOem(partId: string): string {
  return `OEM-${partId.slice(-6).toUpperCase()}`;
}

// --- Seed roster: today's dismantling crew & activity -----------------------------------

type RosterEntry = { userId: string; firstName: string; carsToday: number };

export const dismantlingRoster: RosterEntry[] = [
  { userId: "u-dismantling-2", firstName: "John", carsToday: 5 },
  { userId: "u-dismantling-3", firstName: "Jonathan", carsToday: 3 },
  { userId: "u-dismantling-4", firstName: "Ali", carsToday: 4 },
  { userId: "u-dismantling-5", firstName: "Mahmood", carsToday: 2 },
  { userId: "u-dismantling-6", firstName: "Carlos", carsToday: 3 },
  { userId: "u-dismantling", firstName: "Mike", carsToday: 1 },
];

const rosterNames: Record<string, string> = {
  "u-dismantling-2": "John Alvarez",
  "u-dismantling-3": "Jonathan Pierce",
  "u-dismantling-4": "Ali Hassan",
  "u-dismantling-5": "Mahmood Siddiqui",
  "u-dismantling-6": "Carlos Reyes",
  "u-dismantling": "Mike Torres",
};

const carPool: { year: string; make: string; model: string; engine: string }[] = [
  { year: "2017", make: "Hyundai", model: "Sonata", engine: "2.4L I4" },
  { year: "2015", make: "Ford", model: "F-150", engine: "5.0L V8" },
  { year: "2016", make: "Honda", model: "Accord", engine: "2.4L I4" },
  { year: "2018", make: "Toyota", model: "Camry", engine: "2.5L I4" },
  { year: "2019", make: "Nissan", model: "Rogue", engine: "2.5L I4" },
  { year: "2017", make: "Chevrolet", model: "Malibu", engine: "1.5L Turbo I4" },
  { year: "2016", make: "Jeep", model: "Grand Cherokee", engine: "3.6L V6" },
  { year: "2018", make: "Kia", model: "Optima", engine: "2.4L I4" },
];

const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"; // no I/O/Q, matches real VIN rules

function seededVin(seed: number): string {
  let s = seed;
  let out = "";
  for (let i = 0; i < 17; i++) {
    s = (s * 48271 + 11) % 2147483647;
    out += VIN_CHARS[s % VIN_CHARS.length];
  }
  return out;
}

function todayAt(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function buildSeed(): { vehicles: VehicleRecord[]; events: VehicleEvent[] } {
  const vehicles: VehicleRecord[] = [];
  const events: VehicleEvent[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // Exactly 3 captured parts across the whole seed are left unresolved, matching the
  // reference's small "Needs Review: 3" queue — PART_REMOVED items otherwise don't use
  // guessReviewStatus() here because its 1-in-4 / 1-in-7 modulo rate would flag far too
  // many of the ~60 seeded parts for a clean, reviewable demo queue.
  const flagged: { employeeIndex: number; vehicleIndex: number; partIndex: number; kind: "needs_review" | "possible_duplicate" }[] = [
    { employeeIndex: 0, vehicleIndex: 0, partIndex: 0, kind: "needs_review" }, // John's 1st car
    { employeeIndex: 2, vehicleIndex: 0, partIndex: 1, kind: "needs_review" }, // Ali's 1st car
    { employeeIndex: 1, vehicleIndex: 0, partIndex: 0, kind: "possible_duplicate" }, // Jonathan's 1st car
  ];

  let globalPartIndex = 0;
  let minuteCursor = 0;

  dismantlingRoster.forEach((entry, employeeIndex) => {
    const employeeName = rosterNames[entry.userId] ?? entry.firstName;

    for (let vehicleIndex = 0; vehicleIndex < entry.carsToday; vehicleIndex++) {
      const vehicleId = `veh-dp-${employeeIndex}-${vehicleIndex}`;
      const car = carPool[(employeeIndex * 3 + vehicleIndex) % carPool.length];
      const vin = seededVin(employeeIndex * 97 + vehicleIndex * 13 + 1000);
      const partCount = 2 + ((employeeIndex + vehicleIndex) % 5); // 2–6 parts per vehicle

      const startHour = 8 + (minuteCursor % 7);
      const startMinute = (minuteCursor * 11) % 60;
      const startedAt = todayAt(startHour, startMinute);
      const finishMinute = (startMinute + 35 + partCount * 4) % 60;
      const finishHour = startHour + Math.floor((startMinute + 35 + partCount * 4) / 60);
      const finishedAt = todayAt(Math.min(finishHour, 18), finishMinute);
      minuteCursor += 1;

      vehicles.push({
        id: vehicleId,
        auctionSource: employeeIndex % 2 === 0 ? "Copart" : "IAA",
        vin,
        lotNumber: `DLOT-${10000 + employeeIndex * 100 + vehicleIndex}`,
        stockNumber: `DS-${4000 + employeeIndex * 100 + vehicleIndex}`,
        auctionItemNumber: "",
        year: car.year,
        make: car.make,
        model: car.model,
        trim: "",
        engine: car.engine,
        mileage: "",
        mileageStatus: "Unknown",
        titleStatus: "Clean",
        location: "LAL Motors Yard",
        purchasePrice: "",
        invoiceAmount: "",
        balanceDue: "",
        auctionFees: "",
        transportationCost: "",
        saleDate: today,
        pickupPin: "",
        pickupStatus: "",
        pickupDeadline: "",
        damageInfo: "",
        transportInfo: "",
        status: "Dismantled",
        assignedId: entry.userId,
        assignedName: employeeName,
        arrivalDate: today,
        createdAt: startedAt,
        unverifiedFields: [],
        pickupLocationName: "LAL Motors Yard",
        pickupAddress: "",
        transportStatus: "ARRIVED",
        transportPrice: "",
        carrierId: null,
        carrierName: null,
        transportProblem: null,
        closedReason: null,
        closedNote: null,
        receivingStatus: "received",
        receivedBy: employeeName,
        receivedAt: startedAt,
        arrivalPhotos: [],
      });

      events.push({
        id: `evt-dp-start-${employeeIndex}-${vehicleIndex}`,
        vehicleId,
        action: "START",
        actorId: entry.userId,
        actorName: employeeName,
        createdAt: startedAt,
        note: "Dismantling started",
        hasPhoto: true,
      });

      for (let partIndex = 0; partIndex < partCount; partIndex++) {
        const partType = guessPartType(globalPartIndex);
        globalPartIndex += 1;
        const partId = `part-dp-${employeeIndex}-${vehicleIndex}-${partIndex}`;
        const flag = flagged.find(
          (f) => f.employeeIndex === employeeIndex && f.vehicleIndex === vehicleIndex && f.partIndex === partIndex
        );
        const disposition =
          flag?.kind === "possible_duplicate"
            ? "POSSIBLE DUPLICATE — MANAGER REVIEW"
            : flag?.kind === "needs_review"
              ? undefined
              : "IN INVENTORY";

        events.push({
          id: `evt-dp-part-${partId}`,
          vehicleId,
          action: "PART_REMOVED",
          actorId: entry.userId,
          actorName: employeeName,
          createdAt: startedAt,
          partType,
          highValue: highValuePartTypes.has(partType),
          disposition,
          hasPhoto: true,
          partId,
        });
      }

      events.push({
        id: `evt-dp-status-${employeeIndex}-${vehicleIndex}`,
        vehicleId,
        action: "STATUS",
        status: "Dismantled",
        actorId: entry.userId,
        actorName: employeeName,
        createdAt: finishedAt,
        note: `Dismantling completed — ${partCount} part photo(s) captured`,
        hasPhoto: true,
      });
    }
  });

  return { vehicles, events };
}

const seed = buildSeed();
export const dismantlingSeedVehicles: VehicleRecord[] = seed.vehicles;
export const dismantlingSeedEvents: VehicleEvent[] = seed.events;

export { dismantlingPartTypes };
