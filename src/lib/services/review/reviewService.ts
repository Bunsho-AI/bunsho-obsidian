/** One whole-manuscript review: build the request from reading units, run it, and keep only findings grounded in the text sent. */
import { randomUUID } from "node:crypto";
import { buildUnits, snapshotId, type PageMeta, type PlannedItem, type SourceChoice } from "@/helpers/sources";
import { PipelineV3Client, type PipelineV3ReviewCallbacks } from "@/lib/contract/pipelineV3Client";
import type { EngineIssue } from "@/lib/contract/engine.types";
import { groundIssues, type GroundingPage } from "@/lib/contract/grounding";
import type { CastMember, PipelineV3Health, PipelineV3Result } from "@/lib/contract/pipelineV3.types";

/** What this review read, in the writer's terms: never reading units. */
export interface ReviewCoverage {
  /** Plan items sent, in order. */
  sources: { id: string; label: string }[];
  /** Plan items the engine could not fully read. */
  unreadSources: string[];
  /** Plan items the writer left out. */
  excluded: number;
}

export interface ReviewOutcome {
  checkedAt: number;
  snapshotId: string;
  /** What was picked when this ran: the panel shows a review only for its own source. */
  source: SourceChoice;
  pages: PageMeta[];
  issues: EngineIssue[];
  coverage: ReviewCoverage;
  refundedCredits: number;
  droppedFindings: number;
}

export interface RunReviewInput {
  items: readonly PlannedItem[];
  source: SourceChoice;
  health: PipelineV3Health;
  workspaceId: string;
  client: Pick<PipelineV3Client, "review">;
  /** The price the writer saw; the engine refuses a review that would cost more. */
  maxCredits?: number;
  callbacks?: PipelineV3ReviewCallbacks;
  /** The book's cast, for the World tab. */
  onCast?: (cast: CastMember[]) => void;
  signal?: AbortSignal;
}

export async function runReview(input: RunReviewInput): Promise<ReviewOutcome> {
  const { items, health } = input;
  const { units, pages } = buildUnits(items);
  const snapshot = snapshotId(units);
  const start = {
    reviewId: randomUUID(),
    workspaceId: input.workspaceId,
    snapshotId: snapshot,
    scope: "full" as const,
    policyId: health.policyId,
    readPolicyId: health.readPolicyId,
    pages: units.map((u) => ({ pageId: u.pageId, order: u.order, rev: u.rev, send: "whole" as const, ...(u.part ? { part: u.part } : {}) })),
    cachedReads: [],
    pins: [],
    focusNames: [],
    ...(input.maxCredits === undefined ? {} : { maxCredits: input.maxCredits }),
  };
  const result: PipelineV3Result = await input.client.review(
    { start, pages: units.map((u) => ({ pageId: u.pageId, text: u.text })), passages: [] },
    input.callbacks, input.signal);

  input.onCast?.(result.cast);
  const grounding = new Map<string, GroundingPage>(units.map((u) => [u.pageId, { pageId: u.pageId, pageOrder: u.order, rev: u.rev, text: u.text }]));
  const grounded = groundIssues(result.issues, snapshot, grounding);
  const unread = new Set(result.unreadPages ?? []);
  const included = items.filter((item) => item.included);
  return {
    checkedAt: Date.now(),
    snapshotId: snapshot,
    source: input.source,
    pages,
    issues: grounded.issues,
    coverage: {
      sources: included.map(({ id, label }) => ({ id, label })),
      unreadSources: [...new Set(pages.filter((p) => unread.has(p.pageId)).map((p) => p.sourceId))],
      excluded: items.length - included.length,
    },
    refundedCredits: result.refundedCredits ?? 0,
    droppedFindings: grounded.droppedIssues,
  };
}
