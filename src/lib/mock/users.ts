import type { User } from "@/lib/types";

export const mockUsers: User[] = [
  { id: "u-owner", name: "Marcus Lal", email: "marcus@lalmotors.com", role: "owner" },
  { id: "u-engineer", name: "Priya Nair", email: "priya@lalmotors.com", role: "engineer_admin" },
  { id: "u-manager", name: "Denise Ford", email: "denise@lalmotors.com", role: "manager" },
  { id: "u-employee", name: "Jamal Reeves", email: "jamal@lalmotors.com", role: "employee" },
  { id: "u-auction", name: "Carlos Mendez", email: "carlos@lalmotors.com", role: "auction" },
  { id: "u-yard", name: "Tyler Brooks", email: "tyler@lalmotors.com", role: "auction" },
  { id: "u-receiving", name: "John Smith", email: "john@lalmotors.com", role: "receiving" },
  { id: "u-dismantling", name: "Mike Torres", email: "mike@lalmotors.com", role: "dismantling" },
  { id: "u-dismantling-2", name: "John Alvarez", email: "john.alvarez@lalmotors.com", role: "dismantling" },
  { id: "u-dismantling-3", name: "Jonathan Pierce", email: "jonathan.pierce@lalmotors.com", role: "dismantling" },
  { id: "u-dismantling-4", name: "Ali Hassan", email: "ali.hassan@lalmotors.com", role: "dismantling" },
  { id: "u-dismantling-5", name: "Mahmood Siddiqui", email: "mahmood.siddiqui@lalmotors.com", role: "dismantling" },
  { id: "u-dismantling-6", name: "Carlos Reyes", email: "carlos.reyes@lalmotors.com", role: "dismantling" },
  { id: "u-driver", name: "Saeed Karimi", email: "saeed@lalmotors.com", role: "scrap_driver" },
  { id: "u-driver-2", name: "Navid Farahani", email: "navid@lalmotors.com", role: "scrap_driver" },
  { id: "u-driver-3", name: "Carlos Diaz", email: "carlos.diaz@lalmotors.com", role: "scrap_driver" },
  { id: "u-driver-4", name: "Mike Sanders", email: "mike.sanders@lalmotors.com", role: "scrap_driver" },
  { id: "u-loading", name: "Ahmed Khalil", email: "ahmed@lalmotors.com", role: "container_loading" },
  { id: "u-export", name: "Sofia Reyes", email: "sofia@lalmotors.com", role: "export_manager" },
];

export const staff: { id: string; name: string; role: string }[] = mockUsers.map((u) => ({
  id: u.id,
  name: u.name,
  role: u.role,
}));
