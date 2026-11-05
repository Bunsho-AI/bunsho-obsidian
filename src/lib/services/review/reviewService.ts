/** One review: build the request from reading units, run it, and keep only findings grounded in the text sent. */
import { randomUUID } from "node:crypto";
import { cachedReadBudget, castFocus, castNameGroups, fitCachedReads, selectPassages } from "@/helpers/passages";
import { usableReads, type KeptRead } from "@/helpers/reads";
import type { CurrentChapter, MergeRun, ReviewCoverage, ReviewOutcome } from "@/helpers/reviewMerge";
import { buildUnits, snapshotId, type PlannedItem, type SourceChoice } from "@/helpers/sources";
import { PipelineV3Client, PipelineV3Error, type PipelineV3ReviewCallbacks } from "@/lib/contract/pipelineV3Client";
import { groundIssues, type GroundingPage } from "@/lib/contract/grounding";
import type { EngineIssue } from "@/lib/contract/engine.types";
import { PIPELINE_V3_LIMITS, PIPELINE_V3_PRICE_OP, type CastMember, type ChapterRead, type PipelineV3Health, type PipelineV3Pin, type PipelineV3Result } from "@/lib/contract/pipelineV3.types";
import { PIPELINE_V3_CANON_PRICE_OP, pipelineV3CanonCredits, pipelineV3ReviewCredits } from "@/lib/contract/pipelineV3Pricing";

export type { ReviewCoverage, ReviewOutcome };

/** What the plugin kept from earlier checks. A chapter check sees the rest of the book through it. */
export interface KnownBook { reads: readonly KeptRead[]; cast: readonly CastMember[]; fromFullReview: boolean }

export interface RunReviewInput {
  items: readonly PlannedItem[];
  source: SourceChoice;
  health: PipelineV3Health;
  workspaceId: string;
  client: Pick<PipelineV3Client, "review">;
  /** The price the writer saw; the engine refuses a review that would cost more. */
  maxCredits?: number;
  callbacks?: PipelineV3ReviewCallbacks;
  signal?: AbortSignal;
  /** Plan items to check. Absent: a full review. Every other item goes as passages, whichever way it is cut. */
  scope?: ReadonlySet<string> | null;
  known?: KnownBook;
  /** The writer's canon: every active pin is checked on the pages being checked, free. */
  pins?: readonly PipelineV3Pin[];
}

/** One finished review, before anything is stored. */
export interface ReviewRun extends MergeRun {
  checkedAt: number;
  coverage: ReviewCoverage;
  cast: CastMember[];
  readPolicyId: string;
  /** Pages sent whole. */
  checked: string[];
  /** Every page with text, as sent. */
  texts: Map<string, CurrentChapter>;
  /** A chapter check that could not compare against the book, so it may not be recorded as checked. */
  alone: boolean;
  /** Findings that did not survive the journey (grounding or the frame check). What they said is unknown, so nothing can be proved gone. */
  lostFindings: number;
  cachedReads: number;
}

/**
 * Refuses, before anything is spent, a review that costs more than the price the writer confirmed: the text or the engine's
 * pricing changed after the quote. The engine refuses it too.
 */
export function assertWithinConfirmedPrice(credits: number | null, maxCredits: number | undefined): void {
  if (maxCredits === undefined || credits === null || credits <= maxCredits) return;
  throw new PipelineV3Error("price_changed", { credits, charged: false },
    `This review now costs about ${credits.toLocaleString("en-US")} credits, more than the ${maxCredits.toLocaleString("en-US")} you confirmed. Check the new price and try again.`);
}

export async function runReview(input: RunReviewInput): Promise<ReviewRun> {
  const { items, health, known } = input;
  const { units, pages } = buildUnits(items);
  const scope = input.scope ?? null;
  const checkedUnits = scope ? units.filter((unit) => scope.has(unit.sourceId)) : units;
  const whole = new Set(checkedUnits.map((unit) => unit.pageId));
  const others = units.filter((unit) => !whole.has(unit.pageId));
  const snapshot = snapshotId(units);

  // The engine charges the text sent whole, once per review.
  const checkedChars = checkedUnits.reduce((n, unit) => n + unit.text.length, 0);
  assertWithinConfirmedPrice(pipelineV3ReviewCredits({ op: PIPELINE_V3_PRICE_OP, creditsPerThousandChars: health.pricing.creditsPerThousandChars, minimumUnits: health.pricing.minimumUnits }, checkedChars), input.maxCredits);

  const asPage = (unit: (typeof units)[number]) => ({ pageId: unit.pageId, pageOrder: unit.order, text: unit.text });
  const checked = checkedUnits.map(asPage);
  const usable: ChapterRead[] = known ? usableReads(known.reads, health.readPolicyId, units.map((unit) => ({ pageId: unit.pageId, rev: unit.rev, order: unit.order }))) : [];
  // A chapter check weighs the rest of the book by person, through the cast, not by name spelling.
  const cast = scope ? known?.cast ?? [] : [];
  const focus = scope ? castFocus({ cast, checked, reads: usable }) : null;
  const startBase = {
    reviewId: randomUUID(),
    workspaceId: input.workspaceId,
    snapshotId: snapshot,
    scope: scope ? "chapters" as const : "full" as const,
    policyId: health.policyId,
    readPolicyId: health.readPolicyId,
    // Every chapter is listed, even one with no selected passages: the engine keeps a cached read as context only for a chapter
    // listed at that read's revision.
    pages: units.map((u) => ({ pageId: u.pageId, order: u.order, rev: u.rev, send: whole.has(u.pageId) ? "whole" as const : "passages" as const, ...(u.part ? { part: u.part } : {}) })),
    pins: [...(input.pins ?? [])],
    focusNames: focus?.focusNames ?? [],
    ...(input.maxCredits === undefined ? {} : { maxCredits: input.maxCredits }),
  };
  const cachedReads = fitCachedReads(usable, checked.map((page) => page.pageOrder), whole, cachedReadBudget({ ...startBase, cachedReads: [] }));
  const selection = scope ? selectPassages({ checked, others: others.map(asPage), factParagraphs: focus?.factParagraphs,
    nameGroups: castNameGroups(cast, cachedReads.filter((read) => whole.has(read.pageId))) }) : null;
  // A chapter check claims the chapter was checked against the book only when the book is known: a full review built the cast
  // the passages were chosen by, or every other chapter's read goes along as context.
  const sentReads = new Set(cachedReads.map((read) => read.pageId));
  const alone = Boolean(scope) && others.length > 0 && !known?.fromFullReview && !others.every((unit) => sentReads.has(unit.pageId));

  const result: PipelineV3Result = await input.client.review(
    { start: { ...startBase, cachedReads }, pages: checkedUnits.map((u) => ({ pageId: u.pageId, text: u.text })), passages: selection?.passages ?? [] },
    input.callbacks, input.signal);

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
    unreadPages: result.unreadPages ?? [],
    capped: (result.stats?.shortlistDropped ?? 0) > 0 || (result.stats?.canonPinsDropped ?? 0) > 0,
    cast: result.cast,
    readPolicyId: result.readPolicyId,
    checked: [...whole],
    texts: new Map(units.map((u) => [u.pageId, { rev: u.rev, text: u.text }])),
    alone,
    lostFindings: grounded.droppedIssues + (result.malformedIssues ?? 0),
    cachedReads: cachedReads.length,
  };
}

/** The most pinned facts one review can carry (engine protocol.ts MAX_V3_PINS). Past it the engine refuses the whole start. */
export const MAX_PINS = 200;

/** What Check canon costs for this book and these pins: the characters at the canon rate, plus each pin. Null when the engine offers no canon price. */
export function canonCredits(health: PipelineV3Health, chars: number, pins: number): number | null {
  const { canonCreditsPerThousandChars: rate, canonCreditsPerPin, minimumUnits } = health.pricing;
  if (rate === null || rate === undefined) return null;
  return pipelineV3CanonCredits({ op: PIPELINE_V3_CANON_PRICE_OP, creditsPerThousandChars: rate, minimumUnits }, chars, pins, canonCreditsPerPin);
}

export type CanonRun =
  /** Not every chapter's names would fit or are known: nothing was sent, and nothing charged. */
  | { kind: "unread" }
  | { kind: "ran"; snapshotId: string; pages: ReviewRun["pages"]; issues: EngineIssue[]; capped: boolean; skipped: boolean; lostFindings: number; texts: Map<string, CurrentChapter>; refundedCredits: number };

export interface RunCanonInput {
  items: readonly PlannedItem[];
  health: PipelineV3Health;
  workspaceId: string;
  client: Pick<PipelineV3Client, "review">;
  pins: readonly PipelineV3Pin[];
  reads: readonly KeptRead[];
  maxCredits?: number;
  callbacks?: PipelineV3ReviewCallbacks;
  signal?: AbortSignal;
}

const FRAME_MARGIN_BYTES = 256 * 1024;
const framed = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * "Check canon": the pins alone across the whole book (desktop runPipelineV3CanonReview.ts). Every chapter goes whole, with its read's
 * cast and none of its facts: the engine reads nothing, and takes the pinned people's names from them. The pass can only prove the
 * canon holds if every chapter's names went along, so otherwise it is not bought.
 */
export async function runCanonReview(input: RunCanonInput): Promise<CanonRun> {
  const { health, pins } = input;
  const { units, pages } = buildUnits(input.items);
  const snapshot = snapshotId(units);
  const chars = units.reduce((n, unit) => n + unit.text.length, 0);
  assertWithinConfirmedPrice(canonCredits(health, chars, pins.length), input.maxCredits);
  const startBase = {
    reviewId: randomUUID(), workspaceId: input.workspaceId, snapshotId: snapshot, scope: "canon" as const, policyId: health.policyId, readPolicyId: health.readPolicyId,
    pages: units.map((u) => ({ pageId: u.pageId, order: u.order, rev: u.rev, send: "whole" as const, ...(u.part ? { part: u.part } : {}) })),
    pins: [...pins], focusNames: [], ...(input.maxCredits === undefined ? {} : { maxCredits: input.maxCredits }),
  };
  const usable = usableReads(input.reads, health.readPolicyId, units.map((unit) => ({ pageId: unit.pageId, rev: unit.rev, order: unit.order })))
    .map((read) => ({ ...read, facts: [], povBreaks: [], droppedFacts: 0 }));
  let budget = PIPELINE_V3_LIMITS.maxFrameBytes - FRAME_MARGIN_BYTES - framed({ ...startBase, cachedReads: [] });
  const cachedReads = usable.filter((read) => { const size = framed(read) + 1; if (size > budget) return false; budget -= size; return true; });
  if (cachedReads.length !== units.length) return { kind: "unread" };

  const result = await input.client.review({ start: { ...startBase, cachedReads }, pages: units.map((u) => ({ pageId: u.pageId, text: u.text })), passages: [] }, input.callbacks, input.signal);
  const grounding = new Map<string, GroundingPage>(units.map((u) => [u.pageId, { pageId: u.pageId, pageOrder: u.order, rev: u.rev, text: u.text }]));
  const grounded = groundIssues(result.issues, snapshot, grounding);
  return {
    kind: "ran", snapshotId: snapshot, pages, issues: grounded.issues,
    capped: (result.stats?.canonPinsDropped ?? 0) > 0, skipped: (result.stats?.skippedJevRequests ?? 0) > 0,
    lostFindings: grounded.droppedIssues + (result.malformedIssues ?? 0),
    texts: new Map(units.map((u) => [u.pageId, { rev: u.rev, text: u.text }])), refundedCredits: result.refundedCredits ?? 0,
  };
}
