export type AuditLog = {
  id: string;
  action: string;
  userName: string;
  userRole: string;
  summary: string;
  createdAt: string;
};

function daysAgo(n: number, hours = 0) {
  return new Date(Date.now() - n * 86400000 - hours * 3600000).toISOString();
}

export const auditLogs: AuditLog[] = [
  { id: "a1", action: "VEHICLE_STATUS", userName: "Carlos Mendez", userRole: "auction", summary: "Set 2019 Toyota Corolla to In Transit", createdAt: daysAgo(0, 2) },
  { id: "a2", action: "PART_APPROVED", userName: "Denise Ford", userRole: "manager", summary: "Approved 2018 Ford F-150 Alternator to inventory", createdAt: daysAgo(0, 5) },
  { id: "a3", action: "CUSTOMER_CREATED", userName: "Denise Ford", userRole: "manager", summary: "Added customer Ray Whitfield (CU-1003)", createdAt: daysAgo(1) },
  { id: "a4", action: "DISPATCH_CREATED", userName: "Carlos Mendez", userRole: "auction", summary: "Dispatched 2 vehicles with Interstate Carriers LLC", createdAt: daysAgo(1, 4) },
  { id: "a5", action: "COMPLETION_APPROVED", userName: "Marcus Lal", userRole: "owner", summary: "Approved completion for 2021 Honda Accord", createdAt: daysAgo(2) },
  { id: "a6", action: "SCRAP_CHECK", userName: "Denise Ford", userRole: "manager", summary: "Recorded scrap check CHK-102 for Renee Holt", createdAt: daysAgo(2, 3) },
  { id: "a7", action: "INVOICE_FINALIZED", userName: "Denise Ford", userRole: "manager", summary: "Finalized export invoice EXP-5501 for LALU4471982", createdAt: daysAgo(3) },
  { id: "a8", action: "USER_ROLE_CHANGED", userName: "Marcus Lal", userRole: "owner", summary: "Changed Priya Nair's role to Engineer Admin", createdAt: daysAgo(4) },
  { id: "a9", action: "PART_REMOVED", userName: "Tyler Brooks", userRole: "auction", summary: "Logged catalytic converter removal on 2018 Ford F-150", createdAt: daysAgo(39) },
  { id: "a10", action: "VEHICLE_CONFIRMED", userName: "Carlos Mendez", userRole: "auction", summary: "Confirmed 2020 Chevrolet Equinox into inventory", createdAt: daysAgo(12) },
];
