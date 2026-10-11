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
  must_change_password: boolean;
};

/** Every role an account can be created or re-assigned as, through the owner's Team page. "owner" is excluded on purpose — it is never granted through the UI (team_set_role, migration 0044, rejects it server-side too). */
export const ASSIGNABLE_ROLES: Role[] = [
  "engineer_admin", "manager", "employee", "auction", "scrap_driver", "receiving", "dismantling", "container_loading", "export_manager",
];

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
