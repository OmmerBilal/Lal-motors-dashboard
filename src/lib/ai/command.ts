import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { callStructured } from "@/lib/ai/openai";
import { AiProviderError, type AiErrorCategory, AI_ERROR_MESSAGE } from "@/lib/ai/provider-errors";
import { TOOL_BY_NAME, toolCatalog, allowedBy, ToolError, type ToolContext, type Tool } from "@/lib/ai/tools";

/**
 * Command orchestration. The model proposes ONE named tool and JSON arguments. Everything after that is
 * deterministic server code: name lookup, role check, argument validation, read or proposal, approval.
 * On any provider failure nothing is executed and no result is invented.
 */
export type CommandResult =
  | { kind: "answer"; text: string }
  | { kind: "read"; tool: string; data: unknown }
  | { kind: "proposal"; requestId: string; tool: string; preview: { summary: string; target: string; fields: unknown } }
  | { kind: "error"; category: string; message: string };

export async function contextFor(): Promise<ToolContext> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = (auth?.claims?.sub as string | undefined) ?? "";
  if (!userId) throw new ToolError("forbidden", "Your session has ended. Sign in again.");
  const { data: roles, error } = await supabase.rpc("ai_caller_roles");
  if (error) throw new ToolError("forbidden", "Your role could not be checked.");
  return { supabase, roles: (roles as string[]) ?? [], userId };
}

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tool", "arguments_json", "reply"],
  properties: {
    tool: { type: "string" },
    arguments_json: { type: "string", description: "JSON object of arguments for the chosen tool, or {}" },
    reply: { type: "string", description: "A short sentence for the user." },
  },
};
const intentParser = z.object({ tool: z.string().min(1).max(60), arguments_json: z.string().max(4000), reply: z.string().max(500) });

/** Free text: the model chooses a named tool. Unknown or unauthorised tools are refused here. */
export async function runCommandText(ctx: ToolContext, text: string): Promise<CommandResult> {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 1000) return { kind: "error", category: "invalid", message: "Write a command of 3 to 1000 characters." };
  const catalog = toolCatalog(ctx.roles);
  const names = catalog.map((t) => t.name);
  let intent;
  try {
    intent = await callStructured({
      system:
        "You route requests for an auto-parts business. Choose exactly one tool from the catalog, or the tool name none " +
        "when no tool fits; then ask for the missing detail in reply. Put the arguments in arguments_json as a JSON object " +
        "matching the tool schema. Never write SQL. Never invent identifiers. Catalog: " + JSON.stringify(catalog),
      user: trimmed,
      schemaName: "ai_intent",
      schema: { ...INTENT_SCHEMA, properties: { ...INTENT_SCHEMA.properties, tool: { type: "string", enum: [...names, "none"] } } },
      parse: (raw) => intentParser.parse(raw),
    });
  } catch (err) {
    return providerFailure(err);
  }
  if (intent.tool === "none") return { kind: "answer", text: intent.reply };
  let args: unknown;
  try {
    args = JSON.parse(intent.arguments_json || "{}");
  } catch {
    return { kind: "error", category: "invalid", message: "The request did not produce valid arguments. Nothing was done." };
  }
  return runTool(ctx, intent.tool, args);
}

/** Explicit tool call from the UI (a person picked the tool). No model involved. */
export async function runTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<CommandResult> {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { kind: "error", category: "unknown_tool", message: "That tool does not exist. Nothing was done." };
  if (!allowedBy(tool, ctx.roles)) return { kind: "error", category: "forbidden", message: "Your role cannot use this tool." };
  const parsed = tool.args.safeParse(rawArgs ?? {});
  if (!parsed.success) return { kind: "error", category: "invalid", message: "The arguments do not match the tool. Nothing was done." };
  const args = parsed.data as Record<string, unknown>;
  try {
    if (tool.kind === "read") {
      return { kind: "read", tool: tool.name, data: await tool.run!(ctx, args) };
    }
    return await proposeWrite(ctx, tool, args);
  } catch (err) {
    return toolFailure(err);
  }
}

async function proposeWrite(ctx: ToolContext, tool: Tool, args: Record<string, unknown>): Promise<CommandResult> {
  const preview = await tool.preview!(ctx, args);
  const { data, error } = await ctx.supabase.rpc("ai_propose_action", {
    p_tool: tool.name,
    p_arguments: args,
    p_target_summary: preview.target,
    p_fingerprint: preview.fingerprint,
    p_preview: { summary: preview.summary, target: preview.target, fields: preview.fields },
    p_client_request_id: randomUUID(),
  });
  if (error) throw new ToolError("forbidden", error.message);
  const row = data as { id: string };
  return { kind: "proposal", requestId: row.id, tool: tool.name, preview: { summary: preview.summary, target: preview.target, fields: preview.fields } };
}

/** Approval: the person approved this exact proposal. The server revalidates, then calls the existing RPC. */
export async function approveRequest(ctx: ToolContext, requestId: string): Promise<CommandResult> {
  const { data, error } = await ctx.supabase.rpc("ai_decide_action", { p_request: requestId, p_decision: "approve" });
  if (error) return { kind: "error", category: "rejected", message: error.message };
  const row = data as { id: string; tool: string; arguments: Record<string, unknown>; fingerprint: string; status: string };
  if (row.status !== "approved") {
    return { kind: "error", category: "already_decided", message: `This request is already ${row.status}. Nothing was changed again.` };
  }
  const tool = TOOL_BY_NAME.get(row.tool);
  if (!tool || tool.kind !== "write" || !allowedBy(tool, ctx.roles)) {
    await recordResult(ctx, row.id, "failed", null, "forbidden");
    return { kind: "error", category: "forbidden", message: "Your role cannot run this action. Nothing was changed." };
  }
  try {
    const now = await tool.preview!(ctx, row.arguments);
    if (now.fingerprint !== row.fingerprint) {
      await recordResult(ctx, row.id, "stale", null, "stale");
      return { kind: "error", category: "stale", message: "The record changed after this was proposed. Nothing was changed. Propose the action again." };
    }
    const result = await tool.execute!(ctx, row.arguments, row.id);
    await recordResult(ctx, row.id, "executed", result, null);
    return { kind: "read", tool: tool.name, data: result };
  } catch (err) {
    const category = err instanceof ToolError ? err.category : "rejected";
    await recordResult(ctx, row.id, "failed", null, category);
    return toolFailure(err);
  }
}

export async function rejectRequest(ctx: ToolContext, requestId: string): Promise<CommandResult> {
  const { error } = await ctx.supabase.rpc("ai_decide_action", { p_request: requestId, p_decision: "reject" });
  if (error) return { kind: "error", category: "rejected", message: error.message };
  return { kind: "answer", text: "Proposal rejected. Nothing was changed." };
}

async function recordResult(ctx: ToolContext, id: string, status: "executed" | "failed" | "stale", result: unknown, category: string | null) {
  await ctx.supabase.rpc("ai_record_result", {
    p_request: id,
    p_status: status,
    p_result: result === null ? null : (result as object),
    p_error_category: category,
  });
}

export function providerFailure(err: unknown): CommandResult {
  const category: AiErrorCategory = err instanceof AiProviderError ? err.category : "unknown";
  return { kind: "error", category, message: AI_ERROR_MESSAGE[category] };
}

function toolFailure(err: unknown): CommandResult {
  if (err instanceof ToolError) return { kind: "error", category: err.category, message: err.message };
  if (err instanceof AiProviderError) return providerFailure(err);
  return { kind: "error", category: "unknown", message: "The action failed. Nothing was changed." };
}

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}
