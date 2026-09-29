export type ScrapLoadToday = {
  id: string;
  driverName: string;
  createdAt: string;
  ticketUploadedAt: string | null;
  ticketNumber: string | null;
  checkId: string | null;
};

function hoursAgo(n: number) {
  return new Date(Date.now() - n * 3600000).toISOString();
}

export const scrapLoadsToday: ScrapLoadToday[] = [
  { id: "scrap-4471a2c9", driverName: "Renee Holt", createdAt: hoursAgo(1), ticketUploadedAt: hoursAgo(1), ticketNumber: "88213", checkId: null },
  { id: "scrap-9c02e711", driverName: "Renee Holt", createdAt: hoursAgo(3), ticketUploadedAt: null, ticketNumber: null, checkId: null },
  { id: "scrap-1a4f5d80", driverName: "Renee Holt", createdAt: hoursAgo(6), ticketUploadedAt: hoursAgo(6), ticketNumber: null, checkId: "chk-102" },
];

export const scrapTotalsToday = {
  loads: scrapLoadsToday.length,
  pendingTickets: scrapLoadsToday.filter((l) => !l.ticketUploadedAt).length,
  weight: 14280,
  amount: 3120,
};
