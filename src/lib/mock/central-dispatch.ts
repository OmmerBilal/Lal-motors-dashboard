export const dispatchIntakeFields: [string, string][] = [
  ["auctionSource", "Auction"],
  ["lotNumber", "Lot #"],
  ["vin", "VIN"],
  ["year", "Year"],
  ["make", "Make"],
  ["model", "Model"],
  ["location", "Pickup location"],
  ["pickupAddress", "Auction address"],
  ["pickupPin", "PIN / buyer #"],
  ["purchasePrice", "Purchase price"],
];

export type DispatchVehicle = {
  id: string;
  lotNumber: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  location: string;
  pickupPin: string;
  pickupAddress: string;
  status: string;
  dispatchId: string | null;
  dispatchStatus: string | null;
  dispatchDate: string | null;
  company: string | null;
  arrivalDate: string | null;
};

export type Carrier = {
  id: string;
  company: string;
  driver: string;
  phone: string;
  email: string;
  address: string;
  mcDot: string;
  notes: string;
};

export type DispatchNote = { id: string; actorName: string; createdAt: string; note: string };

export type DispatchItem = {
  id: string;
  vehicleId: string;
  lotNumber: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  pickupLocation: string;
  price: number;
  status: "Assigned" | "Awaiting Pickup" | "Picked Up" | "In Transit" | "Arrived";
};

export type DispatchJob = {
  id: string;
  carrierId: string;
  company: string;
  driver: string;
  phone: string;
  email: string;
  destination: string;
  status: "Assigned" | "Partial Delivery" | "Delivered";
  createdAt: string;
  items: DispatchItem[];
  notes: DispatchNote[];
};

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

export const carriers: Carrier[] = [
  {
    id: "car-1",
    company: "Southeast Auto Transport",
    driver: "Mike Alvarez",
    phone: "(904) 555-0142",
    email: "dispatch@setransport.com",
    address: "1220 Freight Rd, Jacksonville, FL",
    mcDot: "MC-882140",
    notes: "Reliable, prefers morning pickups.",
  },
  {
    id: "car-2",
    company: "Interstate Carriers LLC",
    driver: "Dana Price",
    phone: "(912) 555-0199",
    email: "",
    address: "",
    mcDot: "MC-441098",
    notes: "",
  },
];

export const dispatchVehicles: DispatchVehicle[] = [
  {
    id: "dv-1",
    lotNumber: "48213077",
    vin: "1FTFW1ET5DFC10312",
    year: "2018",
    make: "Ford",
    model: "F-150",
    location: "Copart Jacksonville",
    pickupPin: "5521",
    pickupAddress: "9700 Pritchard Rd, Jacksonville, FL",
    status: "Available at Yard",
    dispatchId: "job-1",
    dispatchStatus: "Arrived",
    dispatchDate: daysAgo(45).slice(0, 10),
    company: "Southeast Auto Transport",
    arrivalDate: daysAgo(41).slice(0, 10),
  },
  {
    id: "dv-2",
    lotNumber: "77120094",
    vin: "3GNAXUEV5LL118842",
    year: "2020",
    make: "Chevrolet",
    model: "Equinox",
    location: "IAA Orlando",
    pickupPin: "",
    pickupAddress: "5900 Cargo Rd, Orlando, FL",
    status: "Awaiting Pickup",
    dispatchId: "job-2",
    dispatchStatus: "Awaiting Pickup",
    dispatchDate: daysAgo(3).slice(0, 10),
    company: "Interstate Carriers LLC",
    arrivalDate: null,
  },
  {
    id: "dv-3",
    lotNumber: "51882201",
    vin: "2T1BURHE0JC014477",
    year: "2019",
    make: "Toyota",
    model: "Corolla",
    location: "Copart Savannah",
    pickupPin: "8834",
    pickupAddress: "410 Cargo Loop, Savannah, GA",
    status: "In Transit",
    dispatchId: "job-2",
    dispatchStatus: "In Transit",
    dispatchDate: daysAgo(3).slice(0, 10),
    company: "Interstate Carriers LLC",
    arrivalDate: null,
  },
  {
    id: "dv-4",
    lotNumber: "48311209",
    vin: "1HGCV1F34LA012933",
    year: "2021",
    make: "Honda",
    model: "Accord",
    location: "Copart Jacksonville",
    pickupPin: "4471",
    pickupAddress: "9700 Pritchard Rd, Jacksonville, FL",
    status: "Purchased",
    dispatchId: null,
    dispatchStatus: null,
    dispatchDate: null,
    company: null,
    arrivalDate: null,
  },
  {
    id: "dv-5",
    lotNumber: "",
    vin: "",
    year: "2017",
    make: "Nissan",
    model: "Altima",
    location: "Manheim Atlanta",
    pickupPin: "",
    pickupAddress: "",
    status: "Purchased",
    dispatchId: null,
    dispatchStatus: null,
    dispatchDate: null,
    company: null,
    arrivalDate: null,
  },
];

export const dispatchJobs: DispatchJob[] = [
  {
    id: "job-1",
    carrierId: "car-1",
    company: "Southeast Auto Transport",
    driver: "Mike Alvarez",
    phone: "(904) 555-0142",
    email: "dispatch@setransport.com",
    destination: "LAL Motors Yard",
    status: "Delivered",
    createdAt: daysAgo(45),
    items: [
      {
        id: "item-1",
        vehicleId: "dv-1",
        lotNumber: "48213077",
        vin: "1FTFW1ET5DFC10312",
        year: "2018",
        make: "Ford",
        model: "F-150",
        pickupLocation: "Copart Jacksonville",
        price: 375,
        status: "Arrived",
      },
    ],
    notes: [{ id: "n-1", actorName: "Carlos Mendez", createdAt: daysAgo(40), note: "Delivered on schedule." }],
  },
  {
    id: "job-2",
    carrierId: "car-2",
    company: "Interstate Carriers LLC",
    driver: "Dana Price",
    phone: "(912) 555-0199",
    email: "",
    destination: "LAL Motors Yard",
    status: "Partial Delivery",
    createdAt: daysAgo(3),
    items: [
      {
        id: "item-2",
        vehicleId: "dv-2",
        lotNumber: "77120094",
        vin: "3GNAXUEV5LL118842",
        year: "2020",
        make: "Chevrolet",
        model: "Equinox",
        pickupLocation: "IAA Orlando",
        price: 410,
        status: "Awaiting Pickup",
      },
      {
        id: "item-3",
        vehicleId: "dv-3",
        lotNumber: "51882201",
        vin: "2T1BURHE0JC014477",
        year: "2019",
        make: "Toyota",
        model: "Corolla",
        pickupLocation: "Copart Savannah",
        price: 300,
        status: "In Transit",
      },
    ],
    notes: [],
  },
];

export function buildBol(job: DispatchJob) {
  return [
    "LAL MOTORS — DISPATCH / BILL OF LADING",
    `Dispatch ${job.id}`,
    `Carrier: ${job.company} · Driver: ${job.driver} · ${job.phone}`,
    `Destination: ${job.destination}`,
    "",
    ...job.items.map(
      (i) => `${i.lotNumber || "—"} / ${i.vin || "—"} — ${i.year} ${i.make} ${i.model} — $${i.price.toFixed(2)}`
    ),
  ].join("\n");
}

export const dispatchStatusFlow: Record<DispatchItem["status"], DispatchItem["status"] | null> = {
  Assigned: "Awaiting Pickup",
  "Awaiting Pickup": "Picked Up",
  "Picked Up": "In Transit",
  "In Transit": "Arrived",
  Arrived: null,
};
