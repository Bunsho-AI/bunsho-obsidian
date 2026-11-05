/**
 * The engine's canon_conflict finding, as the card and the Resolve screen read it (desktop shared/canon/canonConflict.ts and
 * ContinuityTab/canonConflict.ts). One reading, so the two can never disagree. Anything less than a complete context, with a
 * citation, is an ordinary finding: never a half-built card.
 */
import type { CanonTarget } from "@/helpers/canon/pen";
import { canonMark, dimensionLabelFor, type Coordinate } from "@/helpers/canon/world";
import { isWriterSource, type CanonTracking } from "@/helpers/canon/record";
import type { EngineIssue, EngineIssueCitation } from "@/lib/contract/engine.types";

export const CANON_CONFLICT_ISSUE_TYPE = "canon_conflict";

export interface CanonConflictContext { entityId: string; dimension: string; pinnedStateId: string; pinnedValue: string; declaredAt: string | null; conflictValues: string[] }

const present = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export function readCanonConflictContext(raw: unknown): CanonConflictContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const context = raw as Record<string, unknown>;
  const entityId = present(context.entityId);
  const dimension = present(context.dimension);
  const pinnedStateId = present(context.pinnedStateId);
  const pinnedValue = present(context.pinnedValue);
  if (!entityId || !dimension || !pinnedStateId || !pinnedValue) return null;
  const conflictValues = Array.isArray(context.conflictValues) ? context.conflictValues.filter((v): v is string => typeof v === "string") : [];
  return { entityId, dimension, pinnedStateId, pinnedValue, declaredAt: present(context.declaredAt), conflictValues };
}

export interface CanonConflictView {
  context: CanonConflictContext;
  /** The manuscript side. */
  page: EngineIssueCitation;
  /** `Ch. 41 contradicts canon` */
  title: string;
  coordinate: string;
  factLabel: string;
  /** `Selma · eye colour` */
  factId: string;
  mark: string;
  /** Further passages, past the first. */
  more: Array<{ citation: EngineIssueCitation; line: string }>;
  /** Still pinned now: a pin the writer reverted leaves its card until the next check, with nothing left to revert. */
  pinned: boolean;
  target: CanonTarget;
}

/** `chapter` is a page's place among the plan's items, counted from one. */
export function buildCanonConflictView(issue: EngineIssue, tracking: CanonTracking, chapter: (pageId: string, pageOrder: number) => number, coordinate: Coordinate): CanonConflictView | null {
  if (issue.type !== CANON_CONFLICT_ISSUE_TYPE) return null;
  let raw: unknown = null;
  try { raw = JSON.parse(issue.context_json); } catch { return null; }
  const context = readCanonConflictContext(raw);
  const page = issue.citations.find((c) => c.evidence_role === "current_conflict") ?? issue.citations[0];
  if (!context || !page) return null;
  const names = new Map(tracking.entities.entities.map((entity) => [entity.entityId, entity.canonicalName]));
  const state = tracking.timeline.states.find((s) => s.stateId === context.pinnedStateId);
  const pinned = Boolean(state) && !state?.closedAt && isWriterSource(state?.openedAt) && state?.entityId === context.entityId && state?.dimension === context.dimension && state?.value === context.pinnedValue;
  const factLabel = dimensionLabelFor(context.dimension, (id) => names.get(id) ?? null);
  const subject = names.get(context.entityId) ?? (raw as { subject?: unknown }).subject;
  const entity = typeof subject === "string" ? subject : "";
  const others = issue.citations.filter((c) => c !== page);
  return {
    context, page, factLabel, pinned,
    title: `Ch. ${chapter(page.page_id, page.page_order)} contradicts canon`,
    coordinate: coordinate(page.page_id) ?? page.location_label,
    factId: `${entity ? `${entity} · ` : ""}${factLabel.toLocaleLowerCase()}`,
    mark: state ? canonMark(state.openedAt, coordinate) : canonMark(context.declaredAt ? { origin: "writer", declaredAt: context.declaredAt } : null, coordinate),
    more: others.map((citation, at) => {
      const value = context.conflictValues[at + 1];
      const where = `ch${chapter(citation.page_id, citation.page_order)}`;
      return { citation, line: value ? `also ${where}: ${value}` : `also ${where}` };
    }),
    target: { kind: "state", stateId: context.pinnedStateId, entityId: context.entityId, dimension: context.dimension, value: context.pinnedValue },
  };
}
