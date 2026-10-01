import { AppShell } from "@/components/shell/app-shell";
import { VehicleDataProvider } from "@/components/vehicles/vehicle-data-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <VehicleDataProvider>
      <AppShell>{children}</AppShell>
    </VehicleDataProvider>
  );
}
