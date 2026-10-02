export type Role =
  | "owner"
  | "engineer_admin"
  | "manager"
  | "employee"
  | "auction"
  | "yard"
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
  yard: "Yard Employee",
  receiving: "Vehicle Receiving Employee",
  dismantling: "Dismantling Employee",
  scrap_driver: "Scrap Driver",
  container_loading: "Container Loading Employee",
  export_manager: "Export Manager",
};

export const rolePhaseLabels: Record<Role, string> = {
  owner: "Full System",
  engineer_admin: "Engineering Operations",
  manager: "Front Desk Portal",
  auction: "Auction Inventory",
  yard: "Yard Vehicle Work",
  receiving: "Vehicle Receiving",
  dismantling: "Dismantling",
  scrap_driver: "Scrap Driver",
  employee: "Warehouse App",
  container_loading: "Container Loading",
  export_manager: "Export Operations",
};
