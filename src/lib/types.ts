export type Role =
  | "owner"
  | "engineer_admin"
  | "manager"
  | "employee"
  | "auction"
  | "receiving"
  | "dismantling"
  | "scrap_driver"
  | "container_loading"
  | "export_manager";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export const roleLabels: Record<Role, string> = {
  owner: "Owner / Admin",
  engineer_admin: "Engineer Admin",
  manager: "Front Desk Manager",
  employee: "Warehouse Employee",
  auction: "Auction Vehicle Inventory",
  receiving: "Vehicle Receiving Employee",
  dismantling: "Dismantling Employee App",
  scrap_driver: "Scrap Driver",
  container_loading: "Container Loading Employee",
  export_manager: "Export Manager",
};

export const rolePhaseLabels: Record<Role, string> = {
  owner: "Full System",
  engineer_admin: "Engineering Operations",
  manager: "Front Desk Portal",
  auction: "Auction Inventory",
  receiving: "Vehicle Receiving",
  dismantling: "Dismantling Employee App",
  scrap_driver: "Scrap Driver",
  employee: "Warehouse App",
  container_loading: "Container Loading",
  export_manager: "Export Operations",
};
