/** What a finding's card and Resolve screen show, decided the way the desktop decides it. Pure: no Obsidian, no DOM. */
import type { EngineIssue, EngineIssueCitation } from "@/lib/contract/engine.types";

/** The desktop's words for a finding the writer has settled. */
export type Resolution = "dismissed" | "closed manual" | "closed auto";

/** The one passage on a card: the current conflict when the engine marks one, else the first citation. */
export function cardEvidence(issue: EngineIssue): EngineIssueCitation | null {
  return issue.citations.find((c) => c.evidence_role === "current_conflict") ?? issue.citations[0] ?? null;
}

/** The sides of the contradiction, in the engine's order: the first is "This page", the rest "Contradicts". */
export function railEvidence(issue: EngineIssue): EngineIssueCitation[] {
  return issue.citations.filter((c) => c.evidence_role !== "supporting_context");
}

const comparable = (text: string): string => text.toLowerCase().replace(/\s+/gu, " ").trim();
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export interface ResolverContext { note: string | null; subject: string | null; summary: string | null }

/** The Note and Context blocks. The engine often repeats the finding as its summary; the title already says it. */
export function resolverContext(issue: EngineIssue): ResolverContext {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(issue.context_json ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch { /* context is decoration: a finding with broken context still shows its evidence */ }
  const summary = text(issue.evidence_summary);
  return { note: text(raw.suggestion), subject: text(raw.subject), summary: summary && comparable(summary) !== comparable(issue.message) ? summary : null };
}

/** The open finding after this one, wrapping; null when no other is open. */
export function nextOpenIssue(open: readonly EngineIssue[], currentId: string): EngineIssue | null {
  const others = open.filter((issue) => issue.issue_id !== currentId);
  if (others.length === 0) return null;
  const at = open.findIndex((issue) => issue.issue_id === currentId);
  return open[(at + 1) % open.length];
}

export function resolutionOf(id: string, dismissed: ReadonlySet<string>, deliberate: ReadonlySet<string>, fixed: ReadonlySet<string> = new Set()): Resolution | null {
  if (dismissed.has(id)) return "dismissed";
  if (deliberate.has(id)) return "closed manual";
  return fixed.has(id) ? "closed auto" : null;
}

/** The order the panel lists open findings in: errors first. "Next Issue" follows it. */
export function displayOrder(open: readonly EngineIssue[]): EngineIssue[] {
  return [...open.filter((issue) => issue.severity === "error"), ...open.filter((issue) => issue.severity !== "error")];
}
