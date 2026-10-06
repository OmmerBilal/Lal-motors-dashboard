"use client";

import { WarehouseApp } from "@/components/warehouse/warehouse-app";

/** Owner review of the Warehouse Employee App. The same screen the employee sees: no capture and no loading jobs. */
export default function PreviewWarehousePage() {
  return <WarehouseApp preview />;
}
