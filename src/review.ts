/** One whole-manuscript review: build the request from chapters, run it, and keep only findings grounded in the text sent. */
import { randomUUID } from "node:crypto";
import type { Chapter } from "./structure";
import { snapshotId } from "./structure";
import { PipelineV3Client, type PipelineV3ReviewCallbacks } from "./vendor/pipelineV3Client";
import type { EngineIssue } from "./vendor/engine.types";
import { groundIssues, type GroundingPage } from "./vendor/grounding";
import type { PipelineV3Health, PipelineV3Result } from "./vendor/pipelineV3.types";

export interface ChapterMeta { pageId: string; title: string; order: number; rev: string }

export interface ReviewOutcome {
  checkedAt: number;
  snapshotId: string;
  chapters: ChapterMeta[];
  issues: EngineIssue[];
  /** Chapters the engine could not read: not proven checked. */
  unreadPages: string[];
  refundedCredits: number;
  droppedFindings: number;
}

export interface RunReviewInput {
  chapters: readonly Chapter[];
  health: PipelineV3Health;
  workspaceId: string;
  client: Pick<PipelineV3Client, "review">;
  /** The price the writer saw; the engine refuses a review that would cost more. */
  maxCredits?: number;
  callbacks?: PipelineV3ReviewCallbacks;
  signal?: AbortSignal;
}

export async function runReview(input: RunReviewInput): Promise<ReviewOutcome> {
  const { chapters, health } = input;
  const snapshot = snapshotId(chapters);
  const start = {
    reviewId: randomUUID(),
    workspaceId: input.workspaceId,
    snapshotId: snapshot,
    scope: "full" as const,
    policyId: health.policyId,
    readPolicyId: health.readPolicyId,
    pages: chapters.map((c) => ({ pageId: c.pageId, order: c.order, rev: c.rev, send: "whole" as const })),
    cachedReads: [],
    pins: [],
    focusNames: [],
    ...(input.maxCredits === undefined ? {} : { maxCredits: input.maxCredits }),
  };
  const result: PipelineV3Result = await input.client.review(
    { start, pages: chapters.map((c) => ({ pageId: c.pageId, text: c.text })), passages: [] },
    input.callbacks, input.signal);

  const pages = new Map<string, GroundingPage>(chapters.map((c) => [c.pageId, { pageId: c.pageId, pageOrder: c.order, rev: c.rev, text: c.text }]));
  const grounded = groundIssues(result.issues, snapshot, pages);
  return {
    checkedAt: Date.now(),
    snapshotId: snapshot,
    chapters: chapters.map(({ pageId, title, order, rev }) => ({ pageId, title, order, rev })),
    issues: grounded.issues,
    unreadPages: result.unreadPages ?? [],
    refundedCredits: result.refundedCredits ?? 0,
    droppedFindings: grounded.droppedIssues,
  };
}
