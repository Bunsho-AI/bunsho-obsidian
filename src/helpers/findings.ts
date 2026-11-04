/** What a finding's card and Resolve screen show, decided the way the desktop decides it. Pure: no Obsidian, no DOM. */
import type { EngineIssue, EngineIssueCitation } from "@/lib/contract/engine.types";

/** The desktop's words for a finding the writer has settled. */
export type Resolution = "dismissed" | "closed manual";

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
export function nextOpenIssue(open: EngineIssue[], currentId: string): EngineIssue | null {
  const others = open.filter((issue) => issue.issue_id !== currentId);
  if (others.length === 0) return null;
  const at = open.findIndex((issue) => issue.issue_id === currentId);
  return open[(at + 1) % open.length];
}

export function resolutionOf(id: string, dismissed: ReadonlySet<string>, deliberate: ReadonlySet<string>): Resolution | null {
  if (dismissed.has(id)) return "dismissed";
  return deliberate.has(id) ? "closed manual" : null;
}

/** The order the panel lists open findings in: errors first. "Next Issue" follows it. */
export function displayOrder(open: readonly EngineIssue[]): EngineIssue[] {
  return [...open.filter((issue) => issue.severity === "error"), ...open.filter((issue) => issue.severity !== "error")];
}

const contextOf = (issue: EngineIssue): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(issue.context_json ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
};
const normalized = (value: string): string => value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
const nameWords = (name: string): Set<string> => new Set(name.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean));

/** The cast names an individual differently run to run ("Mira", "Mira Tennant"); "Ed" is not "Fred". */
function sameIndividual(a: string, b: string): boolean {
  if (!a || !b || a === b) return true;
  const [x, y] = [nameWords(a), nameWords(b)];
  const within = (small: Set<string>, big: Set<string>) => small.size > 0 && [...small].every((word) => big.has(word));
  return within(x, y) || within(y, x);
}

interface FindingFacts { issue: EngineIssue; shape: string; subject: string; quotes: string[] }

function factsOf(issue: EngineIssue): FindingFacts {
  const context = contextOf(issue);
  const kind = context.findingType === "plot_hole" ? "contradiction" : typeof context.findingType === "string" ? context.findingType : issue.type;
  const pin = typeof context.pinnedStateId === "string" ? context.pinnedStateId : "";
  const pages = [...new Set(issue.citations.map((citation) => citation.page_id))].sort().join(",");
  return {
    issue, shape: `${kind}|${pin}|${pages}`,
    subject: typeof context.subject === "string" ? context.subject.normalize("NFC").trim().toLocaleLowerCase() : "",
    quotes: issue.citations.map((citation) => normalized(citation.quoted_text)),
  };
}

/**
 * The desktop's adoptPriorFindings, for settled findings. The engine keys a finding by the text it cites, so an edit that
 * leaves the problem in place returns a new id. A new finding takes a settled one's id only when they have the same kind,
 * pin and chapters, a compatible individual and a shared quote, and the match is unambiguous, so a new problem is never
 * saved under an old decision.
 */
export function keepSettledFindings(issues: readonly EngineIssue[], prior: readonly EngineIssue[], settled: ReadonlySet<string>): EngineIssue[] {
  const reproduced = new Set(issues.map((issue) => issue.issue_id));
  const news = issues.filter((issue) => !settled.has(issue.issue_id)).map(factsOf);
  const olds = prior.filter((issue) => settled.has(issue.issue_id) && !reproduced.has(issue.issue_id)).map(factsOf);
  const score = (n: FindingFacts, o: FindingFacts): number => {
    if (n.shape !== o.shape || !sameIndividual(n.subject, o.subject)) return 0;
    if (!n.quotes.some((x) => x && o.quotes.some((y) => y && (x.includes(y) || y.includes(x))))) return 0;
    return 1 + (n.subject && n.subject === o.subject ? 4 : 0) + (n.issue.type === o.issue.type ? 2 : 0);
  };
  const best = <A, B>(item: A, among: readonly B[], rate: (a: A, b: B) => number): B | undefined => {
    const scores = among.map((other) => rate(item, other));
    const top = Math.max(0, ...scores);
    return top > 0 && scores.filter((value) => value === top).length === 1 ? among[scores.indexOf(top)] : undefined;
  };
  const adopted = new Map<EngineIssue, string>();
  for (const n of news) {
    const o = best(n, olds, score);
    if (o && best(o, news, (a, b) => score(b, a)) === n) adopted.set(n.issue, o.issue.issue_id);
  }
  return issues.map((issue) => {
    const id = adopted.get(issue);
    return id ? { ...issue, issue_id: id } : issue;
  });
}
