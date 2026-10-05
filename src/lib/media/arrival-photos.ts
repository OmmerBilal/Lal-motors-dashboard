/**
 * Canonical arrival photo roles. The upload role, the saved-photo query prefix, the Receiving slots and the
 * receive_vehicle SQL (0059: `m.role in ('arrival_front', 'arrival_rear', 'arrival_left', 'arrival_right')`)
 * all use these exact strings. Change one and you must change all of them.
 */
export const ARRIVAL_ROLE_PREFIX = "arrival_";
export const ARRIVAL_EXTRA_ROLE = "arrival_extra";

export const ARRIVAL_PHOTO_SLOTS = [
  { id: "front", label: "Front View", role: "arrival_front" },
  { id: "rear", label: "Rear View", role: "arrival_rear" },
  { id: "left", label: "Left Side", role: "arrival_left" },
  { id: "right", label: "Right Side", role: "arrival_right" },
] as const;

export type ArrivalSlotId = (typeof ARRIVAL_PHOTO_SLOTS)[number]["id"];

export type ArrivalPhotoCompletion = {
  front: boolean;
  rear: boolean;
  left: boolean;
  right: boolean;
  completedCount: number;
  complete: boolean;
  missing: { id: ArrivalSlotId; label: string }[];
  /** The persisted media id per slot, or null. Used to show each slot as saved. */
  mediaIdBySlot: Record<ArrivalSlotId, string | null>;
};

/**
 * The one completion result for the Receiving screen: progress, the missing-photo message and the Confirm Arrival gate.
 * It reads only server-persisted, ready originals for the selected vehicle (the list the server returns). Local previews
 * and in-flight uploads are not in that list, so they never count. Extra photos and any role outside the four do not count.
 * The server returns newest first, so the first match for a role is the most recent photo for that slot.
 */
export function getArrivalPhotoCompletion(savedMedia: readonly { id: string; role: string | null }[] | undefined): ArrivalPhotoCompletion {
  const mediaIdBySlot = {} as Record<ArrivalSlotId, string | null>;
  for (const slot of ARRIVAL_PHOTO_SLOTS) {
    mediaIdBySlot[slot.id] = savedMedia?.find((m) => m.role === slot.role)?.id ?? null;
  }
  const missing = ARRIVAL_PHOTO_SLOTS.filter((slot) => !mediaIdBySlot[slot.id]).map((slot) => ({ id: slot.id, label: slot.label }));
  const completedCount = ARRIVAL_PHOTO_SLOTS.length - missing.length;
  return {
    front: !!mediaIdBySlot.front,
    rear: !!mediaIdBySlot.rear,
    left: !!mediaIdBySlot.left,
    right: !!mediaIdBySlot.right,
    completedCount,
    complete: missing.length === 0,
    missing,
    mediaIdBySlot,
  };
}
