import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { VehicleDataProvider } from "@/components/vehicles/vehicle-data-context";
import { PartsDataProvider } from "@/components/parts/parts-data-context";
import { ScrapDataProvider } from "@/components/scrap/scrap-data-context";
import { ContainersDataProvider } from "@/components/containers/containers-data-context";
import { SalesDataProvider } from "@/components/sales/sales-data-context";
import { createClient } from "@/lib/supabase/server";

// Mounted once here (instead of per-page) so shared records/state survive
// navigation between Parts, Scrap, Containers and Sales instead of resetting.
//
// Server-side auth guard: middleware.ts already redirects unauthenticated requests to
// /login before this renders, so this check is defense in depth, not the only gate — but
// it closes the specific "direct URL access must be blocked server-side" requirement at
// the layout level too, independent of middleware's matcher config ever drifting. Real
// authorization (which role may see which data) still happens at the RLS/trigger layer in
// the database, never here or in middleware — this layout only confirms a session exists.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  // Local JWT signature check (no remote call). The proxy already gated the request.
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) {
    redirect("/login");
  }

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
