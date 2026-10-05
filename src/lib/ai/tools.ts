import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Named AI tool registry. The model chooses only from these names. Each tool has a role list, an argument schema,
 * and calls an existing business RPC. No tool runs SQL. Writes never run from a proposal: they run only from the
 * approval route, after the state is re-read and compared with the fingerprint captured at proposal time.
 */
export type ToolContext = { supabase: Awaited<ReturnType<typeof createClient>>; roles: string[]; userId: string };

export type WritePreview = { summary: string; target: string; fields: unknown; fingerprint: string };

export type Tool = {
  name: string;
  kind: "read" | "write";
  description: string;
  roles: string[];
  args: z.ZodType<Record<string, unknown>>;
  run?: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
  preview?: (ctx: ToolContext, args: Record<string, unknown>) => Promise<WritePreview>;
  execute?: (ctx: ToolContext, args: Record<string, unknown>, requestId: string) => Promise<unknown>;
};

/** Management tools call RPCs whose guards admit owner, engineer_admin and manager. export_manager is not in this set. */
const SALES_OFFICE = ["owner", "engineer_admin", "manager"];
const OWNER_ENGINEER = ["owner", "engineer_admin"];
/** owner_dashboard_summary is owner-only in the database; the tool follows it. */
const OWNER_ONLY = ["owner"];

/** Key-sorted serialisation: jsonb round-trips reorder keys, so a fingerprint must not depend on key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value as Record<string, unknown>).sort().map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

export function stateHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex").slice(0, 32);
}

async function rpc(ctx: ToolContext, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) throw new ToolError(error.code === "42501" ? "forbidden" : "rejected", error.message);
  return data;
}

/** A refusal the user can read. The message comes from the RPC, which wrote it for a person. */
export class ToolError extends Error {
  readonly category: "forbidden" | "rejected" | "stale" | "invalid";
  constructor(category: "forbidden" | "rejected" | "stale" | "invalid", message: string) {
    super(message);
    this.category = category;
  }
}

// Plain UUID shape. z.uuid() is strict RFC 9562 and rejects seeded ids such as e0000000-0000-0000-0000-000000000001; Postgres accepts any uuid.
const uuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "Enter a valid id.");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - n * 86400000));

const customerFields = z.object({
  first_name: z.string().trim().min(1).max(80).optional(),
  last_name: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(120).optional(),
  company_name: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const TOOLS: Tool[] = [
  // ------------------------------------------------------------------ reads
  {
    name: "find_customer", kind: "read", description: "Search customers by name, phone, company or email.", roles: SALES_OFFICE,
    args: z.object({ query: z.string().trim().min(2).max(120) }),
    run: (ctx, a) => rpc(ctx, "list_customers", { p_search: a.query, p_limit: 10 }),
  },
  {
    name: "get_customer_history", kind: "read", description: "Sales, quotes and payments for one customer.", roles: SALES_OFFICE,
    args: z.object({ customer_id: uuid }),
    run: (ctx, a) => rpc(ctx, "customer_history", { p_customer_id: a.customer_id }),
  },
  {
    name: "get_sale", kind: "read", description: "One sale with its lines, fulfilment and balance.", roles: SALES_OFFICE,
    args: z.object({ sale_id: uuid }),
    run: (ctx, a) => rpc(ctx, "get_sale_detail", { p_sale_id: a.sale_id }),
  },
  {
    name: "get_quote", kind: "read", description: "One quote with its lines and status.", roles: SALES_OFFICE,
    args: z.object({ quote_id: uuid }),
    run: (ctx, a) => rpc(ctx, "get_quote_detail", { p_quote_id: a.quote_id }),
  },
  {
    name: "get_payment_status", kind: "read", description: "One customer payment: amount, status and allocations.", roles: SALES_OFFICE,
    args: z.object({ payment_id: uuid }),
    run: (ctx, a) => rpc(ctx, "get_payment_detail", { p_payment_id: a.payment_id }),
  },
  {
    name: "find_part", kind: "read", description: "Search parts by name, SKU or number.", roles: SALES_OFFICE,
    args: z.object({ query: z.string().trim().min(2).max(120) }),
    run: (ctx, a) => rpc(ctx, "list_parts", { p_search: a.query, p_limit: 10 }),
  },
  {
    name: "list_parts_needing_review", kind: "read", description: "Parts waiting for manager review.", roles: OWNER_ENGINEER.concat("manager"),
    args: z.object({}),
    run: (ctx) => rpc(ctx, "list_parts", { p_status: "manager_review", p_limit: 25 }),
  },
  {
    name: "find_vehicle", kind: "read", description: "Search vehicles by VIN, lot or stock number.", roles: SALES_OFFICE,
    args: z.object({ query: z.string().trim().min(3).max(60) }),
    run: (ctx, a) => rpc(ctx, "list_vehicles", { p_search: a.query, p_limit: 10 }),
  },
  {
    name: "get_scrap_status", kind: "read", description: "One scrap load with measurement, payment and discrepancy state.", roles: OWNER_ENGINEER.concat("manager"),
    args: z.object({ load_id: uuid }),
    run: (ctx, a) => rpc(ctx, "scrap_manager_get_load", { p_load_id: a.load_id }),
  },
  {
    name: "list_scrap_exceptions", kind: "read", description: "Open scrap discrepancies.", roles: OWNER_ENGINEER.concat("manager"),
    args: z.object({}),
    run: (ctx) => rpc(ctx, "scrap_manager_list_discrepancies", { p_status: "open", p_limit: 25 }),
  },
  {
    name: "get_container_status", kind: "read", description: "One container with evidence, invoice, payments and shipping state.", roles: ["owner", "engineer_admin", "export_manager"],
    args: z.object({ container_id: uuid }),
    run: (ctx, a) => rpc(ctx, "export_get_container", { p_container_id: a.container_id }),
  },
  {
    name: "get_management_summary", kind: "read", description: "Owner dashboard figures for a date range (defaults to the last 7 days).", roles: OWNER_ONLY,
    args: z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }),
    run: (ctx, a) => rpc(ctx, "owner_dashboard_summary", { p_from: a.from ?? daysAgo(6), p_to: a.to ?? today() }),
  },
  {
    name: "recent_activity", kind: "read", description: "Recent audit activity for a date range (defaults to the last 7 days).", roles: OWNER_ENGINEER,
    args: z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), limit: z.number().int().min(1).max(50).optional() }),
    run: (ctx, a) => rpc(ctx, "employee_recent_activity", { p_from: a.from ?? daysAgo(6), p_to: a.to ?? today(), p_limit: a.limit ?? 25, p_actor: null }),
  },

  // ------------------------------------------------------------------ writes (proposal -> approval -> revalidation -> RPC)
  {
    name: "create_customer", kind: "write", description: "Create a customer (after the user approves).", roles: SALES_OFFICE,
    args: customerFields.extend({ first_name: z.string().trim().min(1).max(80) }),
    preview: async (_ctx, a) => ({
      summary: `Create customer ${a.first_name} ${a.last_name ?? ""}`.trim(),
      target: "new customer",
      fields: a,
      fingerprint: stateHash({ tool: "create_customer", a }),
    }),
    execute: (ctx, a, requestId) => rpc(ctx, "create_customer", { p_data: a, p_client_request_id: requestId }),
  },
  {
    name: "update_customer", kind: "write", description: "Update allowed fields of one customer (after approval).", roles: SALES_OFFICE,
    args: z.object({ customer_id: uuid, fields: customerFields }),
    preview: async (ctx, a) => {
      // The customer's own row (read as the caller, so RLS applies). Any change to it after proposal makes the approval stale.
      const { data: row, error } = await ctx.supabase
        .from("customers")
        .select("id, first_name, last_name, company_name, phone, email, notes, updated_at")
        .eq("id", a.customer_id)
        .maybeSingle();
      if (error) throw new ToolError("forbidden", "You cannot read this customer.");
      if (!row) throw new ToolError("rejected", "Customer not found. Nothing was changed.");
      return { summary: "Update customer details", target: `customer ${a.customer_id}`, fields: a.fields, fingerprint: stateHash({ row, fields: a.fields }) };
    },
    execute: (ctx, a) => rpc(ctx, "update_customer", { p_customer_id: a.customer_id, p_data: a.fields }),
  },
  {
    name: "reserve_sale", kind: "write", description: "Reserve stock for a sale (after approval).", roles: SALES_OFFICE,
    args: z.object({ sale_id: uuid }),
    preview: async (ctx, a) => {
      const current = await rpc(ctx, "get_sale_detail", { p_sale_id: a.sale_id });
      return { summary: "Reserve stock for this sale", target: `sale ${a.sale_id}`, fields: {}, fingerprint: stateHash(current) };
    },
    execute: (ctx, a) => rpc(ctx, "reserve_stock", { p_sale_id: a.sale_id }),
  },
  {
    name: "fulfill_sale", kind: "write", description: "Fulfil a reserved sale (after approval).", roles: SALES_OFFICE,
    args: z.object({ sale_id: uuid }),
    preview: async (ctx, a) => {
      const current = await rpc(ctx, "get_sale_detail", { p_sale_id: a.sale_id });
      return { summary: "Fulfil this sale and consume stock", target: `sale ${a.sale_id}`, fields: {}, fingerprint: stateHash(current) };
    },
    execute: (ctx, a) => rpc(ctx, "fulfill_sales_order", { p_sale_id: a.sale_id }),
  },
  {
    name: "approve_scrap_load", kind: "write", description: "Approve a completed scrap load (after approval).", roles: OWNER_ENGINEER.concat("manager"),
    args: z.object({ load_id: uuid }),
    preview: async (ctx, a) => {
      const current = await rpc(ctx, "scrap_manager_get_load", { p_load_id: a.load_id });
      return { summary: "Approve this scrap load", target: `scrap load ${a.load_id}`, fields: {}, fingerprint: stateHash(current) };
    },
    execute: (ctx, a) => rpc(ctx, "scrap_manager_approve_load", { p_load_id: a.load_id }),
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The tools this caller may use. Roles are checked against the database role list, not the browser. */
export function toolsFor(roles: string[]): Tool[] {
  return TOOLS.filter((t) => t.roles.some((r) => roles.includes(r)));
}

export function allowedBy(tool: Tool, roles: string[]): boolean {
  return tool.roles.some((r) => roles.includes(r));
}

/** A JSON schema description of each tool for the model's structured choice. Generated from the zod schema. */
export function toolCatalog(roles: string[]) {
  return toolsFor(roles).map((t) => ({
    name: t.name,
    kind: t.kind,
    description: t.description,
    arguments_schema: z.toJSONSchema(t.args),
  }));
}
