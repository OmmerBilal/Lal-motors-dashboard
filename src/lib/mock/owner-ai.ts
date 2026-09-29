import { vehicles, vehicleEvents, computeDaysOpen, vehicleTitle } from "@/lib/mock/vehicles";
import { parts } from "@/lib/mock/parts";
import { customers } from "@/lib/mock/sales";
import { mockUsers } from "@/lib/mock/users";

export type AiResultRow = { kind: "vehicle" | "part" | "customer" | "activity"; id: string; title: string; detail: string };

export type AiAnswer = { answer: string; model: string; results: AiResultRow[] };

export const ownerAiExamples = [
  "Show vehicles over 40 days",
  "How many active vehicles do we have?",
  "What did employees do this week?",
  "Show unreconciled high-value parts",
  "Show pending parts",
  "Find part SKU LAL-P-000001",
];

function weekAgo() {
  return Date.now() - 7 * 86400000;
}

export function answerOwnerAi(prompt: string): AiAnswer {
  const q = prompt.toLowerCase();
  const model = "LAL AI (mock preview)";

  if (q.includes("over 40 days") || q.includes("40+ days") || q.includes("overdue")) {
    const overdue = vehicles.filter((v) => computeDaysOpen(v) >= 40);
    return {
      answer: `${overdue.length} vehicle${overdue.length === 1 ? " is" : "s are"} at 40 or more days.`,
      model,
      results: overdue.map((v) => ({ kind: "vehicle", id: v.id, title: vehicleTitle(v), detail: `${computeDaysOpen(v)} days · ${v.status}` })),
    };
  }

  if (q.includes("active vehicle")) {
    const active = vehicles.filter((v) => v.status !== "Processing");
    return { answer: `${active.length} active vehicles in the yard and pipeline.`, model, results: [] };
  }

  if (q.includes("employee") && (q.includes("this week") || q.includes("did"))) {
    const since = weekAgo();
    const recent = vehicleEvents.filter((e) => new Date(e.createdAt).getTime() >= since);
    const byActor = new Map<string, number>();
    recent.forEach((e) => byActor.set(e.actorId, (byActor.get(e.actorId) || 0) + 1));
    const rows: AiResultRow[] = [...byActor.entries()].map(([actorId, count]) => {
      const person = mockUsers.find((u) => u.id === actorId);
      return { kind: "activity", id: actorId, title: person?.name || "Unknown", detail: `${count} action${count === 1 ? "" : "s"} this week` };
    });
    return { answer: `${recent.length} vehicle actions logged across ${rows.length} employee(s) this week.`, model, results: rows };
  }

  if (q.includes("unreconciled") && q.includes("high-value")) {
    const flagged = vehicleEvents.filter((e) => e.action === "PART_REMOVED" && e.highValue && !e.disposition);
    return {
      answer: `${flagged.length} high-value part removal(s) still need a disposition.`,
      model,
      results: flagged.map((e) => ({ kind: "vehicle", id: e.vehicleId, title: e.partType || "High-value part", detail: `Removed by ${e.actorName} · needs disposition` })),
    };
  }

  if (q.includes("pending part")) {
    const pending = parts.filter((p) => p.status !== "approved");
    return {
      answer: `${pending.length} part(s) pending in the capture/review queue.`,
      model,
      results: pending.map((p) => ({ kind: "part", id: p.id, title: p.draft.partName || "Pending identification", detail: p.status.replaceAll("_", " ") })),
    };
  }

  const skuMatch = q.match(/lal-p-\d+|sku[- ]?\S+/i);
  if (skuMatch || q.includes("find part")) {
    const term = skuMatch?.[0] || q.replace("find part", "").trim();
    const matches = parts.filter((p) => [p.stockSku, p.draft.partNumber, p.draft.partName].filter(Boolean).some((f) => String(f).toLowerCase().includes(term.toLowerCase())));
    if (matches.length) {
      return {
        answer: `Found ${matches.length} matching part record.`,
        model,
        results: matches.map((p) => ({ kind: "part", id: p.id, title: p.stockSku || "SKU pending", detail: p.draft.partName || p.draft.title || "" })),
      };
    }
    return { answer: "No matching part found in current records.", model, results: [] };
  }

  const customerMatches = customers.filter((c) =>
    `${c.firstName} ${c.lastName} ${c.companyName} ${c.phone} ${c.customerNumber}`.toLowerCase().includes(q)
  );
  if (customerMatches.length) {
    return {
      answer: `Found ${customerMatches.length} matching customer record.`,
      model,
      results: customerMatches.map((c) => ({ kind: "customer", id: c.id, title: c.customerNumber, detail: c.companyName || `${c.firstName} ${c.lastName}` })),
    };
  }

  return {
    answer: "I couldn't match that to a specific vehicle, part, customer or employee record. Try one of the example questions.",
    model,
    results: [],
  };
}
