/**
 * The desktop's kinds of finding and the Jump to issue picker's grouping (ContinuityTab helpers.ts, clusterNav.ts), over the
 * plugin's findings. Pure. Classifying by the engine's type is structure, not prose, so it holds in every language.
 */
import type { EngineIssue } from "@/lib/contract/engine.types";

export const SPECTRUM_CONFIG = {
  factual: { label: "Factual", icon: "alert-triangle" },
  temporal: { label: "Timeline", icon: "clock" },
  character_arc: { label: "Character Arcs", icon: "users" },
  world: { label: "World", icon: "globe" },
  voice: { label: "Voice", icon: "message-square" },
  plot: { label: "Plot Threads", icon: "git-branch" },
} as const;

export type SpectrumKey = keyof typeof SPECTRUM_CONFIG;
const SPECTRUM_KEYS = Object.keys(SPECTRUM_CONFIG) as SpectrumKey[];

function contextOf(issue: EngineIssue): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(issue.context_json ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export function getIssueSpectrum(issue: EngineIssue): SpectrumKey {
  const raw = contextOf(issue).spectrum;
  if (typeof raw === "string" && raw in SPECTRUM_CONFIG) return raw as SpectrumKey;
  const type = (issue.type || "").toLowerCase();
  if (type === "canon_conflict") return "factual";
  if (type.includes("trait") || type.includes("name")) return "factual";
  if (type.includes("timeline") || type.includes("temporal") || type.includes("age")) return "temporal";
  if (type.includes("arc") || type.includes("character") || type.includes("disappear")) return "character_arc";
  if (type.includes("world") || type.includes("object") || type.includes("geography")) return "world";
  if (type.includes("voice") || type.includes("dialogue") || type.includes("register")) return "voice";
  if (type.includes("thread") || type.includes("setup") || type.includes("subplot")) return "plot";
  return "factual";
}

/** By count, most first; a kind with none is left out; ties keep the desktop's order. */
export function orderSpectrumByCount(issues: readonly EngineIssue[]): Array<{ key: SpectrumKey; count: number }> {
  const counts = new Map<SpectrumKey, number>();
  for (const issue of issues) { const key = getIssueSpectrum(issue); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return SPECTRUM_KEYS.map((key) => ({ key, count: counts.get(key) ?? 0 })).filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count);
}

export function filterBySpectrum<T extends EngineIssue>(issues: readonly T[], spectrum: SpectrumKey | null): readonly T[] {
  return spectrum ? issues.filter((issue) => getIssueSpectrum(issue) === spectrum) : issues;
}

/** What a finding is called, the same in the picker and on its card. */
export function displayIssueTitle(issue: EngineIssue): string {
  const title = contextOf(issue).title;
  return (typeof title === "string" && title) || issue.message || issue.type?.replace(/_/gu, " ") || "Untitled issue";
}

export interface PickerGroup { label: string; rank1: boolean; issues: EngineIssue[] }

/** "Filter open issues…": a match on the title, grouped as the panel groups them. Empty groups are left out. */
export function pickerGroups(open: readonly EngineIssue[], query: string): PickerGroup[] {
  const wanted = query.trim().toLowerCase();
  const matches = wanted ? open.filter((issue) => displayIssueTitle(issue).toLowerCase().includes(wanted)) : open;
  const groups: PickerGroup[] = [
    { label: "Open contradiction", rank1: true, issues: matches.filter((issue) => issue.severity === "error") },
    { label: "Worth a look", rank1: false, issues: matches.filter((issue) => issue.severity !== "error") },
  ];
  return groups.filter((group) => group.issues.length > 0);
}
