import type { User } from "@/lib/types";

export const mockUsers: User[] = [
  { id: "u-owner", name: "Marcus Lal", email: "marcus@lalmotors.com", role: "owner" },
  { id: "u-engineer", name: "Priya Nair", email: "priya@lalmotors.com", role: "engineer_admin" },
  { id: "u-manager", name: "Denise Ford", email: "denise@lalmotors.com", role: "manager" },
  { id: "u-employee", name: "Jamal Reeves", email: "jamal@lalmotors.com", role: "employee" },
  { id: "u-auction", name: "Carlos Mendez", email: "carlos@lalmotors.com", role: "auction" },
  { id: "u-yard", name: "Tyler Brooks", email: "tyler@lalmotors.com", role: "yard" },
  { id: "u-receiving", name: "John Smith", email: "john@lalmotors.com", role: "receiving" },
  { id: "u-driver", name: "Renee Holt", email: "renee@lalmotors.com", role: "scrap_driver" },
];

export const staff: { id: string; name: string; role: string }[] = mockUsers.map((u) => ({
  id: u.id,
  name: u.name,
  role: u.role,
}));
