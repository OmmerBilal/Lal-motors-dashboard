/**
 * The one decision for whether a vehicle can be received. The Auction row, the Auction detail and the Receiving
 * deep link all read it, so they cannot disagree. It uses domain fields only, never display labels. It mirrors
 * receive_vehicle (0006, 0059): the database enforces the same rules, and this only decides what the screen offers.
 */

/** Roles that may receive a vehicle. Matches receive_vehicle and the /vehicle-receiving route. */
export const RECEIVE_ROLES: readonly string[] = ["owner", "engineer_admin", "receiving"];

export type ReceiveFacts = {
  /** Database status, e.g. "Purchased", "Processing", "Available at Yard" or "Dismantled". */
  status: string;
  closedReason: string | null;
  receivingStatus: string;
};

export type ReceiveBlocker = "closed" | "dismantled" | "received";

/** Why the vehicle's own state rules out receiving, or null when the state allows it. The role is not considered here. */
export function receiveStateBlocker(v: ReceiveFacts): ReceiveBlocker | null {
  if (v.closedReason) return "closed";
  if (v.status === "Dismantled") return "dismantled";
  if (v.receivingStatus === "received") return "received";
  return null;
}

/** Whether the Receive action is offered to this role for this vehicle. */
export function canReceiveVehicle(v: ReceiveFacts, role: string): boolean {
  return RECEIVE_ROLES.includes(role) && receiveStateBlocker(v) === null;
}

/** Why the Receive action is disabled for this role/vehicle, or null when it's enabled. For a disabled button's tooltip. */
export function receiveBlockedReason(v: ReceiveFacts, role: string): string | null {
  if (!RECEIVE_ROLES.includes(role)) return "Your role cannot receive vehicles.";
  switch (receiveStateBlocker(v)) {
    case "closed":
      return "This vehicle is closed or removed and cannot be received.";
    case "dismantled":
      return "This vehicle is dismantled and cannot be received.";
    case "received":
      return "This vehicle has already been received.";
    default:
      return null;
  }
}
