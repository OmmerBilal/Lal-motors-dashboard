import { AppShell } from "@/components/shell/app-shell";
import { VehicleDataProvider } from "@/components/vehicles/vehicle-data-context";
import { PartsDataProvider } from "@/components/parts/parts-data-context";
import { ScrapDataProvider } from "@/components/scrap/scrap-data-context";
import { ContainersDataProvider } from "@/components/containers/containers-data-context";
import { SalesDataProvider } from "@/components/sales/sales-data-context";

// Mounted once here (instead of per-page) so shared records/state survive
// navigation between Parts, Scrap, Containers and Sales instead of resetting.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <VehicleDataProvider>
      <PartsDataProvider>
        <ScrapDataProvider>
          <ContainersDataProvider>
            <SalesDataProvider>
              <AppShell>{children}</AppShell>
            </SalesDataProvider>
          </ContainersDataProvider>
        </ScrapDataProvider>
      </PartsDataProvider>
    </VehicleDataProvider>
  );
}
