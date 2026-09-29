export type ScrapLoad = {
  id: string;
  driverId: string;
  driverName: string;
  loadDate: string;
  createdAt: string;
  ticketUploadedAt: string | null;
  weightAmount: number | null;
  amount: number | null;
  ticketNumber: string | null;
  checkId: string | null;
  checkNumber: string | null;
};

export type ScrapCheck = { id: string; driverId: string; loadDate: string; checkNumber: string; createdAt: string };

export function localDay(date: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function hoursAgo(n: number) {
  return new Date(Date.now() - n * 3600000);
}

const todayStr = localDay();
const yesterdayStr = localDay(new Date(Date.now() - 86400000));

export const scrapLoads: ScrapLoad[] = [
  {
    id: "scrap-4471a2c9",
    driverId: "u-driver",
    driverName: "Renee Holt",
    loadDate: todayStr,
    createdAt: hoursAgo(1).toISOString(),
    ticketUploadedAt: hoursAgo(1).toISOString(),
    weightAmount: 5200,
    amount: 1140,
    ticketNumber: "88213",
    checkId: null,
    checkNumber: null,
  },
  {
    id: "scrap-9c02e711",
    driverId: "u-driver",
    driverName: "Renee Holt",
    loadDate: todayStr,
    createdAt: hoursAgo(3).toISOString(),
    ticketUploadedAt: null,
    weightAmount: null,
    amount: null,
    ticketNumber: null,
    checkId: null,
    checkNumber: null,
  },
  {
    id: "scrap-1a4f5d80",
    driverId: "u-driver",
    driverName: "Renee Holt",
    loadDate: todayStr,
    createdAt: hoursAgo(6).toISOString(),
    ticketUploadedAt: hoursAgo(5.5).toISOString(),
    weightAmount: 8900,
    amount: 1980,
    ticketNumber: "88190",
    checkId: "check-1",
    checkNumber: "CHK-102",
  },
  {
    id: "scrap-7712bb44",
    driverId: "u-driver",
    driverName: "Renee Holt",
    loadDate: yesterdayStr,
    createdAt: hoursAgo(28).toISOString(),
    ticketUploadedAt: hoursAgo(27).toISOString(),
    weightAmount: 6100,
    amount: 1340,
    ticketNumber: "88155",
    checkId: "check-1",
    checkNumber: "CHK-102",
  },
];

export const scrapChecks: ScrapCheck[] = [
  { id: "check-1", driverId: "u-driver", loadDate: yesterdayStr, checkNumber: "CHK-102", createdAt: hoursAgo(24).toISOString() },
];

export function computeTotals(loads: ScrapLoad[]) {
  const byDriver = new Map<string, { driverId: string; driverName: string; loads: number; totalWeight: number; totalAmount: number; ticketCount: number; checks: Set<string> }>();
  for (const l of loads) {
    const entry = byDriver.get(l.driverId) ?? { driverId: l.driverId, driverName: l.driverName, loads: 0, totalWeight: 0, totalAmount: 0, ticketCount: 0, checks: new Set<string>() };
    entry.loads += 1;
    entry.totalWeight += l.weightAmount || 0;
    entry.totalAmount += l.amount || 0;
    if (l.ticketUploadedAt) entry.ticketCount += 1;
    if (l.checkId) entry.checks.add(l.checkId);
    byDriver.set(l.driverId, entry);
  }
  return [...byDriver.values()].map((e) => ({
    driverId: e.driverId,
    driverName: e.driverName,
    loads: e.loads,
    totalWeight: e.totalWeight,
    totalAmount: e.totalAmount,
    ticketCount: e.ticketCount,
    checks: e.checks.size,
  }));
}
