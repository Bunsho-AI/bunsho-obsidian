/**
 * Continuity pipeline v3 wire contract (desktop side).
 *
 * ONE CONTRACT: this file mirrors bunsho-engine `src/claims/claims.types.ts` (ChapterRead,
 * CastMember, stages), `src/claims/transport/protocol.ts` + `transport/session.ts` (frames, limits,
 * error codes) and `src/claims/limits.ts` (chapter-read caps) on the `feat/claims_pipeline` branch.
 * Change both sides together.
 *
 * Offsets (`Span`) are UTF-16 offsets into the exact page text the desktop sent, which is the
 * page projection whose content hash is the page `rev`.
 */
import type { EngineIssue } from "./engine.types";

export const PIPELINE_V3_PROTOCOL = "pipeline-v3";
export const PIPELINE_V3_BASE = "/v1/pipeline/v3";
export const PIPELINE_V3_HEALTH_ROUTE = `${PIPELINE_V3_BASE}/health`;
export const PIPELINE_V3_REVIEW_ROUTE = `${PIPELINE_V3_BASE}/review`;
/** Engine metered op (credits.service.ts OP_COSTS.pipeline_v3_kchar) and its formula: shared/continuity/pipelineV3Pricing.ts. */
export { PIPELINE_V3_PRICE_OP } from "./pipelineV3Pricing";

/** Mirrors protocol.ts / validation/limits.ts. Checked locally so an oversized review fails before upload. */
export const PIPELINE_V3_LIMITS = Object.freeze({
  /** MAX_V3_PAGE_CHARS: one page sent whole. */
  maxPageChars: 150_000,
  /** MAX_BOOK_CHARS (= MAX_AUDIT_TOTAL_CHARS): every page sent whole in one review. */
  maxBookChars: 3_000_000,
  /** MAX_V3_PASSAGE_CHARS: all passage text in one chapter-scoped review. */
  maxPassageChars: 400_000,
  /** MAX_AUDIT_PAGES: pages (and cached reads) in one start frame. */
  maxPages: 500,
  /** passagesSchema: paragraphs per passages frame and characters per paragraph. */
  maxParagraphsPerPage: 400,
  maxParagraphChars: 20_000,
  /** MAX_ID_CHARS: pageId, rev, snapshotId, workspaceId. */
  maxIdChars: 300,
  /** READER_TRANSPORT_BYTES: the engine's WebSocket maxPayload, per client frame (the start frame carries every cached read). */
  maxFrameBytes: 8 * 1024 * 1024,
  /**
   * MAX_V3_PAGE_TOKENS / MAX_V3_PARAGRAPHS_PER_PAGE: a page sent whole is refused (too_large, before
   * any charge) above this many estimated tokens (ceil(UTF-8 bytes / 2.5), engine estimateTokens) or
   * this many non-empty lines (paragraphs()).
   */
  maxPageTokens: 90_000,
  bytesPerTokenEstimate: 2.5,
  maxParagraphsPerWholePage: 1_200,
  /** MAX_V3_REVIEWS_PER_USER: concurrent reviews per account per engine instance (else `busy`). */
  maxReviewsPerUser: 2,
  /** MAX_V3_FOCUS_NAMES: the cast's names for a chapter check's people (protocol.ts startSchema focusNames). */
  maxFocusNames: 2000,
});

/**
 * Caps of the engine's `chapterReadSchema` (protocol.ts, numbers from src/claims/limits.ts
 * READ_LIMITS). A cached read over any cap is rejected by the engine's start schema (the whole
 * review fails as invalid_request), so the desktop never sends one back: that chapter is simply
 * read again.
 */
export const CHAPTER_READ_LIMITS = Object.freeze({
  /**
   * MAX_FACTS_PER_CHAPTER in claims.config.ts (re-exported by limits.ts): a chapter is read in two independent passes
   * of up to 48 facts each (limits.maxFactsPerChapter × limits.readPasses), merged, so a cached read can carry 96.
   */
  facts: 96,
  factIdChars: 320,
  factQuoteChars: 2_000,
  subjectChars: 300,
  attributeChars: 300,
  statementChars: 2_000,
  questionChars: 1_000,
  speakerChars: 300,
  cast: 200,
  castNameChars: 300,
  castNames: 60,
  castRoleChars: 600,
  introducedAliases: 20,
  aliasChars: 300,
  aliasQuoteChars: 2_000,
  povCharacterChars: 300,
  povBreaks: 40,
  povQuoteChars: 3_000,
  povExplanationChars: 2_000,
});

export const FACT_KINDS = ["trait", "age_date_duration", "count_number", "clock_time", "relationship", "name_alias",
  "location_travel", "injury_ability", "object_state", "death", "knowledge", "other"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export const FRAMINGS = ["narration", "dialogue", "thought", "letter_or_document"] as const;
/** Engine claims.types.ts WORLD_DIMENSIONS: the World tab's keys a reader files each fact under (one contract); `none` marks
 * a fact that is no property (an action, an event, a promise, a time), which the World leaves out. */
export const WORLD_DIMENSIONS = ["appearance:eye_color", "appearance:hair", "appearance:build", "appearance:age", "appearance:height",
  "appearance:distinguishing_mark", "trait", "motivation", "voice", "location", "injury", "possession", "relationship", "stance",
  "knows", "suspects", "believes_false", "unaware", "other", "none"] as const;
export type WorldDimension = (typeof WORLD_DIMENSIONS)[number];
export type Framing = (typeof FRAMINGS)[number];
export const CAST_KINDS = ["person", "place", "building", "vessel", "animal", "object", "group"] as const;
export type CastKind = (typeof CAST_KINDS)[number];
export const POV_BREAK_TYPES = ["head_hop", "person_drift", "tense_drift"] as const;
export type PovBreakType = (typeof POV_BREAK_TYPES)[number];
export const NARRATION_PERSONS = ["first", "third", "second", "mixed"] as const;
export const NARRATION_TENSES = ["past", "present", "mixed"] as const;

export interface Span { start: number; end: number }

/** One checkable fact from one chapter, grounded to an exact span of that chapter. */
export interface Fact {
  id: string;
  pageId: string;
  order: number;
  span: Span;
  quote: string;
  paragraph: number;
  subject: string;
  attribute: string;
  /** The property's value as the chapter gives it ("flaxen"); reads before read-4 have none. The World tab shows it. */
  value?: string;
  /** The World tab's key for the property (engine WORLD_DIMENSIONS, desktop shared/canon/dimensions.ts), or `other`. */
  dimension?: WorldDimension;
  /** For relationship and possession: the other individual or the object, as the chapter names it. */
  counterpart?: string | null;
  /** The fact's standing as a statement about the world (engine stages/ledger.ts); reads before the state ledger have none and read as `fact`. */
  status?: "fact" | "plan" | "rhetoric" | "estimate" | "rumour" | "corrected";
  kind: FactKind;
  statement: string;
  question: string;
  framing: Framing;
  speaker: string | null;
  textMarksUntrue: boolean;
}

/** How one chapter's reader saw one individual. */
export interface CastRecord {
  pageId: string;
  order: number;
  name: string;
  kind: CastKind;
  names: Array<{ name: string; proper: boolean }>;
  role: string;
  introducedAliases: Array<{ alias: string; quote: string }>;
}

export interface PovBreak { pageId: string; order: number; span: Span; quote: string; type: PovBreakType; explanation: string }

/** One chapter's read. The desktop caches it per page revision under the engine's read policy. */
export interface ChapterRead {
  pageId: string;
  order: number;
  rev: string;
  facts: Fact[];
  cast: CastRecord[];
  narration: { person: (typeof NARRATION_PERSONS)[number]; povCharacter: string; tense: (typeof NARRATION_TENSES)[number] };
  povBreaks: PovBreak[];
  /** Facts whose quote could not be located in the chapter; they are never used as evidence. */
  droppedFacts: number;
}

/** One individual across the book: the cast list with the names the book gives them. */
export interface CastMember {
  id: string;
  name: string;
  kind: CastKind;
  names: string[];
  properNames: string[];
  aliases: string[];
  chapters: number[];
  roles: string[];
  introduced: Array<{ alias: string; pageId: string; quote: string }>;
}

export const CLAIMS_STAGES = ["read", "cast", "search", "triage", "judge", "timeline", "names", "canon", "assemble"] as const;
export type ClaimsStage = (typeof CLAIMS_STAGES)[number];
export interface ClaimsProgress { stage: ClaimsStage; done: number; total: number }

/** GET /v1/pipeline/v3/health (pipelineV3.module.ts). 404 means the engine does not serve v3. */
export interface PipelineV3Health {
  enabled: true;
  protocol: typeof PIPELINE_V3_PROTOCOL;
  /** Whole-pipeline policy; a review started under another policy is refused (policy_mismatch). */
  policyId: string;
  /** Chapter-read policy; cached reads under any other id are ignored engine-side. */
  readPolicyId: string;
  model: string;
  jevModel: string;
  jevEndpoint: string;
  limits: { maxPageChars: number; maxBookChars: number };
  pricing: PipelineV3Pricing;
}

/**
 * pipelineV3.module.ts health `pricing`: creditsPerThousandChars x units, units = max(minimumUnits,
 * ceil(checked chars / 1000)) rounded up once per review over the checked pages' text with spaces.
 * The desktop quotes only these exact semantics (pipelineV3Frames.ts refuses any other).
 */
export interface PipelineV3Pricing {
  creditsPerThousandChars: number;
  minimumUnits: number;
  rounding: "up_once_per_review";
  chars: "checked_text_with_spaces";
  /** "Check canon" rate, same units and rounding; null from an engine without the canon pass. */
  canonCreditsPerThousandChars: number | null;
  /** "Check canon" price per pinned fact (founder 2026-09-27); null from an engine that charges none. */
  canonCreditsPerPin: number | null;
}

/** `canon`: "Check canon", the writer's pins alone across the whole book (every page whole). */
export type PipelineV3Scope = "full" | "chapters" | "canon";
export type PipelineV3PageSend = "whole" | "passages";

export interface PipelineV3StartPage {
  pageId: string;
  /** Story order, 0-based, as the page ledger orders pages. */
  order: number;
  /** The page's content hash (pageContentHash of the projection); citations carry it back. */
  rev: string;
  send: PipelineV3PageSend;
}

/** Client `start` payload (protocol.ts startSchema). */
export interface PipelineV3Start {
  /** Fresh uuid v4 per attempt; also the engine's credit idempotency key. */
  reviewId: string;
  workspaceId: string;
  /** The desktop's manuscriptSnapshotId; citations carry it back in source_ref. */
  snapshotId: string;
  scope: PipelineV3Scope;
  policyId: string;
  readPolicyId: string;
  pages: PipelineV3StartPage[];
  cachedReads: ChapterRead[];
  /** The writer's canon (protocol.ts pinSchema): every active pin, checked on the pages being checked. */
  pins: PipelineV3Pin[];
  /** Chapter checks: every name the book's cast gives the checked chapters' people (passageSelection castFocus). */
  focusNames: string[];
  /** The price the writer confirmed; the engine refuses (`price_changed`) a review that would charge more. */
  maxCredits?: number;
}

/**
 * One pinned fact as the engine checks it (bunsho-engine src/claims/claims.types.ts Pin). `pinId` is the
 * pinned state's id; the engine echoes it with entityId/dimension/value as `pinnedStateId` etc. so the canon
 * card and Revert address exactly this record.
 */
export interface PipelineV3Pin {
  pinId: string;
  entityId: string;
  entityName: string;
  aliases: string[];
  dimension: string;
  value: string;
  declaredAt: string;
}

/** A paragraph as the engine's `paragraphs()` (src/claims/text/manuscript.ts) computes it. */
export interface PipelineV3Paragraph { index: number; start: number; end: number; text: string }

/** Client `page` payload: a page sent whole. */
export interface PipelineV3PageFrame { pageId: string; text: string }
/** Client `passages` payload: the paragraphs selected locally from a page not being checked. */
export interface PipelineV3PassagesFrame { pageId: string; paragraphs: PipelineV3Paragraph[] }

export type PipelineV3ClientFrameType = "start" | "page" | "passages" | "cancel";
export type PipelineV3ServerFrameType = "accepted" | "progress" | "read" | "result" | "error" | "heartbeat";

/**
 * session.ts errorCode()/MESSAGES. `duplicate_review`: the reviewId was used before (the desktop mints
 * a fresh one per attempt, so this is a client bug); `busy`: the account already runs
 * maxReviewsPerUser reviews on that instance; `slow_client`: the socket was not read promptly; `price_changed`: the
 * review would charge more than the `maxCredits` the writer confirmed.
 */
export const PIPELINE_V3_ERROR_CODES = ["invalid_request", "policy_mismatch", "too_large", "insufficient_credits",
  "budget_exceeded", "jev_unavailable", "model_unavailable", "cancelled", "timeout", "duplicate_review", "busy",
  "slow_client", "price_changed", "internal"] as const;
export type PipelineV3ErrorCode = (typeof PIPELINE_V3_ERROR_CODES)[number];

/** Server `accepted`: the review is charged `credits` for `units` (engines before char pricing omit both). */
export interface PipelineV3Accepted { reviewId: string; pages: number; units?: number; credits?: number }
/**
 * Server `error` payload (session.ts finish). `message` is finished writer-facing copy that already
 * ends with "You were not charged." or "This review was charged."; `charged` says which (founder
 * decision 2026-09-26: failures on the engine's side are refunded in full, writer-side stops such as
 * cancel keep the charge). Absent only from engines older than that change.
 */
export interface PipelineV3ErrorPayload { code: PipelineV3ErrorCode; message: string; charged?: boolean }

/** pipeline.ts ClaimsReviewOutput['stats']. Informational; never drives behaviour. */
export interface PipelineV3Stats {
  chapters: number;
  chaptersRead: number;
  cachedReads: number;
  facts: number;
  droppedFacts: number;
  candidates: number;
  shortlisted: number;
  /** Shortlisted pairs past the judge's cap, left unjudged (engines before the cap omit it). */
  shortlistDropped?: number;
  /** Pins with candidates left unjudged by the canon judge's cap. */
  canonPinsDropped?: number;
  skippedJevRequests: number;
  /** The verify stage (head-hop warnings read with their scene before they ship; engines before it omit these). */
  verified?: number;
  verifyDropped?: number;
  verifyDroppedByReason?: Record<string, number>;
  findingsByType: Record<string, number>;
  stageMs: Partial<Record<ClaimsStage, number>>;
  jev: { requests: number; retries: number; inputTokens: number; costUsd: number; missingAnswers: number };
}

/**
 * Server `result` payload. Issues are in the existing wire shape (assemble.ts toIssues): citations
 * carry source_ref {snapshotId,pageId,rev,start,end} and evidence_role prior_fact | current_conflict
 * | supporting_context; context_json carries origin 'pipeline_v3' and clusterKey.
 */
export interface PipelineV3Result {
  reviewId: string;
  /** Issues the desktop dropped at the boundary as malformed (never sent on; logged). Desktop-side only. */
  malformedIssues?: number;
  policyId: string;
  readPolicyId: string;
  issues: EngineIssue[];
  cast: CastMember[];
  /** Checked pages the engine could not read (its maxUnreadChapters): not proven checked. Older engines omit it. */
  unreadPages?: string[];
  /** Credits the engine refunded for chapters it could not read (their share of the charge). */
  refundedCredits?: number;
  stats: PipelineV3Stats;
}
