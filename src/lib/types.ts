export type Role =
  | "owner"
  | "engineer_admin"
  | "manager"
  | "employee"
  | "auction"
  | "yard"
  | "scrap_driver";

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
  auction: "Auction Vehicle Employee",
  yard: "Yard Employee",
  scrap_driver: "Scrap Driver",
};

export const rolePhaseLabels: Record<Role, string> = {
  owner: "Full System",
  engineer_admin: "Engineering Operations",
  manager: "Front Desk Portal",
  auction: "Auction Intake",
  yard: "Yard Vehicle Work",
  scrap_driver: "Scrap Driver",
  employee: "Warehouse App",
};
