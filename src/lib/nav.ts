import {
  Boxes,
  CarFront,
  Camera,
  ClipboardCheck,
  ClipboardList,
  History,
  ScanLine,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/types";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
};

export function getPrimaryNav(role: Role): NavItem[] {
  switch (role) {
    case "owner":
      return [
        { id: "vehicle-workspace", label: "Owner Vehicle Dashboard", href: "/dashboard", icon: CarFront },
        { id: "central-dispatch", label: "Central Dispatch", href: "/central-dispatch", icon: Truck },
        { id: "auction-intake", label: "Auction Vehicle Inventory", href: "/preview/auction", icon: CarFront },
        { id: "vehicle-receiving", label: "Vehicle Receiving & Arrival", href: "/preview/vehicle-receiving", icon: ScanLine },
        { id: "dismantling", label: "Dismantling Employee", href: "/preview/dismantling", icon: Wrench },
        {
          id: "dismantling-processing",
          label: "Vehicle Dismantling Processing",
          href: "/dismantling-processing",
          icon: ClipboardCheck,
        },
        { id: "preview-yard", label: "Yard Employee Workspace", href: "/preview/yard", icon: CarFront },
        { id: "preview-front", label: "Front Desk Manager Portal", href: "/preview/front-desk", icon: ClipboardList },
        { id: "preview-warehouse", label: "Warehouse Employee App", href: "/preview/warehouse", icon: Camera },
        { id: "preview-loading", label: "Container Loading Employee", href: "/preview/loading", icon: Boxes },
        { id: "preview-driver", label: "Scrap Driver App", href: "/preview/scrap-driver", icon: Truck },
        { id: "ai-command-center", label: "AI Command Center", href: "/ai-command-center", icon: Sparkles },
        { id: "parts", label: "Parts Inventory", href: "/parts", icon: ClipboardList },
        { id: "operations", label: "Parts Operations", href: "/operations", icon: Boxes },
        { id: "sales", label: "Customers & Sales", href: "/sales", icon: ShoppingCart },
        { id: "containers", label: "Containers & Export", href: "/containers", icon: Boxes },
        { id: "scrap", label: "Scrap Loads", href: "/scrap", icon: Truck },
        { id: "audit", label: "Audit & History", href: "/audit", icon: History },
        { id: "team", label: "Users & Activity", href: "/team", icon: Users },
      ];
    case "engineer_admin":
      return [
        { id: "vehicle-workspace", label: "Vehicle Operations", href: "/vehicles", icon: CarFront },
        { id: "central-dispatch", label: "Central Dispatch", href: "/central-dispatch", icon: Truck },
        { id: "vehicle-receiving", label: "Vehicle Receiving & Arrival", href: "/vehicle-receiving", icon: ScanLine },
        { id: "dismantling", label: "Dismantling", href: "/dismantling", icon: Wrench },
        {
          id: "dismantling-processing",
          label: "Vehicle Dismantling Processing",
          href: "/dismantling-processing",
          icon: ClipboardCheck,
        },
        { id: "ai-command-center", label: "AI Command Center", href: "/ai-command-center", icon: Sparkles },
        { id: "parts", label: "Parts Inventory", href: "/parts", icon: ClipboardList },
        { id: "operations", label: "Parts Operations", href: "/operations", icon: Boxes },
        { id: "sales", label: "Customers & Sales", href: "/sales", icon: ShoppingCart },
        { id: "containers", label: "Containers & Export", href: "/containers", icon: Boxes },
        { id: "scrap", label: "Scrap Loads", href: "/scrap", icon: Truck },
        { id: "audit", label: "Audit & History", href: "/audit", icon: History },
      ];
    case "manager":
      return [
        {
          id: "dismantling-processing",
          label: "Vehicle Dismantling Processing",
          href: "/dismantling-processing",
          icon: ClipboardCheck,
        },
        { id: "vehicle-workspace", label: "Vehicle Operations", href: "/vehicles", icon: CarFront },
        { id: "central-dispatch", label: "Central Dispatch", href: "/central-dispatch", icon: Truck },
        { id: "parts", label: "Pending Parts & Inventory", href: "/parts", icon: ClipboardList },
        { id: "operations", label: "Parts Operations", href: "/operations", icon: Boxes },
        { id: "sales", label: "Customers & Sales", href: "/sales", icon: ShoppingCart },
        { id: "containers", label: "Containers & Export", href: "/containers", icon: Boxes },
        { id: "scrap", label: "Scrap Loads", href: "/scrap", icon: Truck },
      ];
    case "auction":
    case "yard":
      return [
        {
          id: "vehicle-workspace",
          label: role === "yard" ? "Yard Vehicle Work" : "Auction Vehicle Intake",
          href: "/vehicles",
          icon: CarFront,
        },
        { id: "central-dispatch", label: "Central Dispatch", href: "/central-dispatch", icon: Truck },
        ...(role === "auction" ? [{ id: "scrap", label: "Scrap Loads", href: "/scrap", icon: Truck }] : []),
      ];
    case "receiving":
      return [
        { id: "vehicle-receiving", label: "Vehicle Receiving & Arrival", href: "/vehicle-receiving", icon: ScanLine },
      ];
    case "dismantling":
      return [{ id: "dismantling", label: "Dismantling", href: "/dismantling", icon: Wrench }];
    case "scrap_driver":
      return [{ id: "scrap", label: "My Scrap Loads", href: "/scrap", icon: Truck }];
    case "employee":
    default:
      return [
        { id: "parts", label: "Quick Part Capture", href: "/parts", icon: Camera },
        { id: "containers", label: "My Loading Jobs", href: "/containers", icon: Boxes },
      ];
  }
}

export const ownerPreviews: { id: string; label: string; href: string; role: Role }[] = [
  { id: "auction-intake", label: "Auction Vehicle Inventory", href: "/preview/auction", role: "auction" },
  { id: "vehicle-receiving", label: "Vehicle Receiving Employee", href: "/preview/vehicle-receiving", role: "receiving" },
  { id: "dismantling", label: "Dismantling Employee", href: "/preview/dismantling", role: "dismantling" },
  {
    id: "dismantling-processing",
    label: "Vehicle Dismantling Processing",
    href: "/preview/dismantling-processing",
    role: "manager",
  },
  { id: "preview-yard", label: "Yard Employee Workspace", href: "/preview/yard", role: "yard" },
  { id: "preview-front", label: "Front Desk Manager Portal", href: "/preview/front-desk", role: "manager" },
  { id: "preview-warehouse", label: "Warehouse Employee App", href: "/preview/warehouse", role: "employee" },
  { id: "preview-loading", label: "Container Loading Employee", href: "/preview/loading", role: "employee" },
  { id: "preview-driver", label: "Scrap Driver App", href: "/preview/scrap-driver", role: "scrap_driver" },
];
