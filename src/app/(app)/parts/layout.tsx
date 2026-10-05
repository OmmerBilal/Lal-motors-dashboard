import { PartsDataProvider } from "@/components/parts/parts-data-context";

/** Parts data is loaded only for the routes that show parts. Other routes never request the parts list. */
export default function PartsRouteLayout({ children }: { children: React.ReactNode }) {
  return <PartsDataProvider>{children}</PartsDataProvider>;
}
