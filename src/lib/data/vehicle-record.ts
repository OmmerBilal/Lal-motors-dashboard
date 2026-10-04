import type { ClosedReason, TransportStatus, VehicleRecord } from "@/lib/mock/vehicles";
import type { VehicleListRow } from "@/lib/data/vehicles";

/**
 * Maps a database list row into the VehicleRecord shape the approved screens render.
 * The list DTO is deliberately small. Fields it does not carry (intake detail, photos,
 * completion history) are empty here and are loaded on the detail screen, not in lists.
 */
export function toVehicleRecord(row: VehicleListRow): VehicleRecord {
  return {
    id: row.id,
    auctionSource: row.auction_source,
    vin: row.vin ?? "",
    lotNumber: row.lot_number ?? "",
    stockNumber: row.stock_number ?? "",
    auctionItemNumber: "",
    year: String(row.year),
    make: row.make,
    model: row.model,
    trim: row.trim,
    engine: row.engine ?? "",
    mileage: "",
    mileageStatus: "",
    titleStatus: "",
    location: "",
    purchasePrice: row.purchase_price,
    invoiceAmount: "",
    balanceDue: "",
    auctionFees: "",
    transportationCost: "",
    saleDate: row.purchase_date,
    pickupPin: "",
    pickupStatus: "",
    pickupDeadline: "",
    damageInfo: "",
    transportInfo: "",
    status: row.status,
    assignedId: null,
    assignedName: null,
    arrivalDate: row.arrival_date,
    createdAt: row.created_at,
    unverifiedFields: [],
    pickupLocationName: row.pickup_location_name,
    pickupAddress: "",
    transportStatus: row.transport_status as TransportStatus,
    transportPrice: "",
    carrierId: row.carrier_id,
    carrierName: row.carrier_company,
    transportProblem: null,
    closedReason: row.closed_reason as ClosedReason | null,
    closedNote: null,
    receivingStatus: row.receiving_status as VehicleRecord["receivingStatus"],
    receivedBy: null,
    receivedAt: null,
    arrivalPhotos: [],
  };
}
