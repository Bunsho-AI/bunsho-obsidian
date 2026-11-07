/**
 * Grounding of v3 findings before the plugin shows any (desktop pipelineV3Issues.ts groundIssues, verbatim logic).
 * A citation stands only if its source_ref is an exact slice of the page text at the revision this review sent,
 * under this review's snapshot. A finding survives only while it keeps a grounded `current_conflict` citation.
 */
import type { EngineIssue, EngineIssueCitation } from "./engine.types";
import { exactSourceSlice } from "./sourceReference";

export interface GroundingPage { pageId: string; pageOrder: number; rev: string; text: string }

export interface GroundedIssues {
  issues: EngineIssue[];
  droppedCitations: number;
  droppedIssues: number;
}

function grounded(citation: EngineIssueCitation, snapshotId: string, pages: ReadonlyMap<string, GroundingPage>): boolean {
  const page = pages.get(citation.page_id);
  const source = citation.source_ref;
  return Boolean(page && source && citation.page_order === page.pageOrder && citation.quoted_text.trim()
    && exactSourceSlice(source, citation.quoted_text, snapshotId, page)
    && (!citation.focus_source_ref || (typeof citation.focus_text === "string"
      && exactSourceSlice(citation.focus_source_ref, citation.focus_text, snapshotId, page))));
}

export function groundIssues(issues: readonly EngineIssue[], snapshotId: string, pages: ReadonlyMap<string, GroundingPage>): GroundedIssues {
  let droppedCitations = 0;
  let droppedIssues = 0;
  const kept: EngineIssue[] = [];
  for (const issue of issues) {
    const citations = issue.citations.filter((citation) => grounded(citation, snapshotId, pages));
    droppedCitations += issue.citations.length - citations.length;
    if (!citations.some((citation) => citation.evidence_role === "current_conflict")) {
      droppedIssues += 1;
      continue;
    }
    kept.push(citations.length === issue.citations.length ? issue : { ...issue, citations });
  }
  return { issues: kept, droppedCitations, droppedIssues };
}
