/**
 * Boundary validation for pipeline v3 engine answers. Everything the engine sends is untrusted until
 * it passes here: chapter reads are persisted and sent back verbatim, so they are checked against the
 * engine's own strict `chapterReadSchema` caps (pipelineV3.types.ts CHAPTER_READ_LIMITS); results are
 * checked for the fields the desktop reads.
 */
import type { EngineIssue } from "./engine.types";
import {
  CAST_KINDS, CHAPTER_READ_LIMITS as L, CLAIMS_STAGES, FACT_KINDS, FRAMINGS, NARRATION_PERSONS, NARRATION_TENSES,
  PIPELINE_V3_ERROR_CODES, PIPELINE_V3_LIMITS, PIPELINE_V3_PROTOCOL, POV_BREAK_TYPES, WORLD_DIMENSIONS,
  type CastMember, type ChapterRead, type ClaimsProgress, type PipelineV3Accepted, type PipelineV3ErrorPayload,
  type PipelineV3Health, type PipelineV3Result, type PipelineV3ServerFrameType, type PipelineV3Stats,
} from "./pipelineV3.types";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Json, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const text = (value: unknown, max: number, min = 0): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;
const id = (value: unknown): value is string => text(value, PIPELINE_V3_LIMITS.maxIdChars, 1);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);
const list = (value: unknown, max: number, item: (entry: unknown) => boolean): boolean =>
  Array.isArray(value) && value.length <= max && value.every(item);
const span = (value: unknown): boolean =>
  record(value) && exactKeys(value, ["start", "end"]) && count(value.start) && count(value.end) && value.end > value.start;

/** Fact keys every read carries; `value`, `dimension` and `counterpart` came with read policy read-4 (optional). */
const FACT_KEYS = ["id", "pageId", "order", "span", "quote", "paragraph", "subject", "attribute", "kind", "statement",
  "question", "framing", "speaker", "textMarksUntrue"] as const;
/** `status` (a fact's standing: fact | plan | rhetoric | estimate | rumour | corrected) came with the state ledger. */
const OPTIONAL_FACT_KEYS = ["value", "dimension", "counterpart", "status"] as const;
const FACT_STATUSES = ["fact", "plan", "rhetoric", "estimate", "rumour", "corrected"] as const;
const fact = (value: unknown): boolean => record(value)
  && exactKeys(value, [...FACT_KEYS, ...OPTIONAL_FACT_KEYS.filter((key) => key in value)])
  && (!("value" in value) || text(value.value, L.attributeChars))
  && (!("dimension" in value) || oneOf(WORLD_DIMENSIONS, value.dimension))
  && (!("counterpart" in value) || value.counterpart === null || text(value.counterpart, L.attributeChars))
  && (!("status" in value) || oneOf(FACT_STATUSES, value.status))
  && text(value.id, L.factIdChars) && id(value.pageId) && count(value.order) && span(value.span)
  && text(value.quote, L.factQuoteChars, 1) && count(value.paragraph) && text(value.subject, L.subjectChars)
  && text(value.attribute, L.attributeChars) && oneOf(FACT_KINDS, value.kind) && text(value.statement, L.statementChars)
  && text(value.question, L.questionChars) && oneOf(FRAMINGS, value.framing)
  && (value.speaker === null || text(value.speaker, L.speakerChars)) && typeof value.textMarksUntrue === "boolean";

const castRecord = (value: unknown): boolean => record(value)
  && exactKeys(value, ["pageId", "order", "name", "kind", "names", "role", "introducedAliases"])
  && id(value.pageId) && count(value.order) && text(value.name, L.castNameChars, 1) && oneOf(CAST_KINDS, value.kind)
  && list(value.names, L.castNames, (entry) => record(entry) && exactKeys(entry, ["name", "proper"])
    && text(entry.name, L.castNameChars, 1) && typeof entry.proper === "boolean")
  && text(value.role, L.castRoleChars)
  && list(value.introducedAliases, L.introducedAliases, (entry) => record(entry) && exactKeys(entry, ["alias", "quote"])
    && text(entry.alias, L.aliasChars) && text(entry.quote, L.aliasQuoteChars));

const povBreak = (value: unknown): boolean => record(value)
  && exactKeys(value, ["pageId", "order", "span", "quote", "type", "explanation"])
  && id(value.pageId) && count(value.order) && span(value.span) && text(value.quote, L.povQuoteChars)
  && oneOf(POV_BREAK_TYPES, value.type) && text(value.explanation, L.povExplanationChars);

/**
 * True when `value` is a chapter read the engine's start schema will accept back: exact keys, known
 * enums and every cap. Facts and POV breaks must belong to the read's own page.
 */
export function validChapterRead(value: unknown): value is ChapterRead {
  return record(value)
    && exactKeys(value, ["pageId", "order", "rev", "facts", "cast", "narration", "povBreaks", "droppedFacts"])
    && id(value.pageId) && count(value.order) && id(value.rev)
    && list(value.facts, L.facts, (entry) => fact(entry) && (entry as Json).pageId === value.pageId)
    && list(value.cast, L.cast, castRecord)
    && record(value.narration) && exactKeys(value.narration, ["person", "povCharacter", "tense"])
    && oneOf(NARRATION_PERSONS, value.narration.person) && text(value.narration.povCharacter, L.povCharacterChars)
    && oneOf(NARRATION_TENSES, value.narration.tense)
    && list(value.povBreaks, L.povBreaks, (entry) => povBreak(entry) && (entry as Json).pageId === value.pageId)
    && count(value.droppedFacts);
}

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** The cast list, keeping only the fields this contract names. Null when the shape is wrong. */
export function parseCastMembers(value: unknown): CastMember[] | null {
  if (!Array.isArray(value)) return null;
  const members: CastMember[] = [];
  for (const entry of value) {
    if (!record(entry) || typeof entry.id !== "string" || typeof entry.name !== "string" || !oneOf(CAST_KINDS, entry.kind)
      || !strings(entry.names) || !strings(entry.properNames) || !strings(entry.aliases) || !strings(entry.roles)
      || !Array.isArray(entry.chapters) || !entry.chapters.every(count) || !Array.isArray(entry.introduced)) return null;
    const introduced = entry.introduced.filter((item): item is CastMember["introduced"][number] => record(item)
      && typeof item.alias === "string" && typeof item.pageId === "string" && typeof item.quote === "string")
      .map(({ alias, pageId, quote }) => ({ alias, pageId, quote }));
    members.push({ id: entry.id, name: entry.name, kind: entry.kind, names: [...entry.names], properNames: [...entry.properNames],
      aliases: [...entry.aliases], chapters: [...entry.chapters], roles: [...entry.roles], introduced });
  }
  return members;
}

const hex64 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

/** GET /v1/pipeline/v3/health, narrowed. Throws when the answer is not a usable v3 health. */
export function parsePipelineV3Health(value: unknown): PipelineV3Health {
  const pricing = record(value) ? value.pricing : undefined;
  // The desktop quotes the writer the exact charge; a pricing rule it does not know cannot be quoted.
  if (!record(value) || value.enabled !== true || value.protocol !== PIPELINE_V3_PROTOCOL || !hex64(value.policyId)
    || !hex64(value.readPolicyId) || !record(value.limits) || !count(value.limits.maxPageChars) || !count(value.limits.maxBookChars)
    || !record(pricing) || typeof pricing.creditsPerThousandChars !== "number" || !Number.isFinite(pricing.creditsPerThousandChars)
    || pricing.creditsPerThousandChars < 0 || !count(pricing.minimumUnits)
    || pricing.rounding !== "up_once_per_review" || pricing.chars !== "checked_text_with_spaces") {
    throw new Error("The engine's pipeline v3 health answer is not usable.");
  }
  return {
    enabled: true, protocol: PIPELINE_V3_PROTOCOL, policyId: value.policyId, readPolicyId: value.readPolicyId,
    model: typeof value.model === "string" ? value.model : "", jevModel: typeof value.jevModel === "string" ? value.jevModel : "",
    jevEndpoint: typeof value.jevEndpoint === "string" ? value.jevEndpoint : "",
    limits: { maxPageChars: value.limits.maxPageChars, maxBookChars: value.limits.maxBookChars },
    pricing: { creditsPerThousandChars: pricing.creditsPerThousandChars, minimumUnits: pricing.minimumUnits,
      rounding: "up_once_per_review", chars: "checked_text_with_spaces",
      canonCreditsPerThousandChars: typeof pricing.canonCreditsPerThousandChars === "number" && Number.isFinite(pricing.canonCreditsPerThousandChars)
        && pricing.canonCreditsPerThousandChars >= 0 ? pricing.canonCreditsPerThousandChars : null,
      canonCreditsPerPin: typeof pricing.canonCreditsPerPin === "number" && Number.isFinite(pricing.canonCreditsPerPin)
        && pricing.canonCreditsPerPin >= 0 ? pricing.canonCreditsPerPin : null },
  };
}

const citation = (value: unknown): boolean => record(value) && typeof value.page_id === "string"
  && typeof value.quoted_text === "string" && typeof value.evidence_role === "string" && typeof value.location_label === "string"
  && count(value.page_order);

/** The EngineIssue fields the desktop reads. Citation grounding is checked separately against page text. */
export function wellFormedIssue(value: unknown): value is EngineIssue {
  return record(value) && typeof value.issue_id === "string" && value.issue_id.length > 0 && typeof value.type === "string"
    && oneOf(["error", "warning", "info"] as const, value.severity) && typeof value.message === "string"
    && Array.isArray(value.related_node_ids) && typeof value.context_json === "string"
    && typeof value.issue_confidence === "number" && Number.isFinite(value.issue_confidence)
    && Array.isArray(value.citations) && value.citations.every(citation);
}

export type PipelineV3ServerFrame =
  | { type: "accepted"; payload: PipelineV3Accepted }
  | { type: "progress"; payload: ClaimsProgress }
  | { type: "read"; payload: unknown }
  | { type: "result"; payload: PipelineV3Result }
  | { type: "error"; payload: PipelineV3ErrorPayload }
  | { type: "heartbeat" };

const SERVER_TYPES: readonly PipelineV3ServerFrameType[] = ["accepted", "progress", "read", "result", "error", "heartbeat"];

/**
 * One server frame, or null when it breaks the protocol. A `read` payload is passed through for the
 * caller's own validChapterRead check (an invalid read is skipped, never fatal); a `result` must be
 * whole: every issue well formed and the cast readable.
 */
export function parseServerFrame(raw: string): PipelineV3ServerFrame | null {
  let frame: unknown;
  try { frame = JSON.parse(raw); } catch { return null; }
  if (!record(frame) || frame.protocol !== PIPELINE_V3_PROTOCOL || !oneOf(SERVER_TYPES, frame.type)) return null;
  const payload = frame.payload;
  switch (frame.type) {
    case "heartbeat": return { type: "heartbeat" };
    case "read": return { type: "read", payload };
    case "accepted":
      return record(payload) && typeof payload.reviewId === "string" && count(payload.pages)
        ? { type: "accepted", payload: { reviewId: payload.reviewId, pages: payload.pages,
          ...(count(payload.units) ? { units: payload.units } : {}), ...(count(payload.credits) ? { credits: payload.credits } : {}) } } : null;
    case "progress":
      return record(payload) && oneOf(CLAIMS_STAGES, payload.stage) && count(payload.done) && count(payload.total)
        ? { type: "progress", payload: { stage: payload.stage, done: payload.done, total: payload.total } } : null;
    case "error":
      return record(payload) && typeof payload.code === "string"
        ? { type: "error", payload: { code: oneOf(PIPELINE_V3_ERROR_CODES, payload.code) ? payload.code : "internal",
          message: typeof payload.message === "string" ? payload.message : "",
          ...(typeof payload.charged === "boolean" ? { charged: payload.charged } : {}) } } : null;
    case "result": {
      if (!record(payload) || typeof payload.reviewId !== "string" || typeof payload.policyId !== "string"
        || typeof payload.readPolicyId !== "string" || !Array.isArray(payload.issues)) return null;
      const cast = parseCastMembers(payload.cast);
      if (!cast) return null;
      // A paid result survives one malformed issue: that issue is dropped (and counted), never the review.
      const issues = payload.issues.filter(wellFormedIssue);
      const malformedIssues = payload.issues.length - issues.length;
      const unreadPages = Array.isArray(payload.unreadPages) ? payload.unreadPages.filter((id): id is string => typeof id === "string") : [];
      return { type: "result", payload: { reviewId: payload.reviewId, policyId: payload.policyId, readPolicyId: payload.readPolicyId,
        issues, cast, stats: (record(payload.stats) ? payload.stats : {}) as unknown as PipelineV3Stats,
        ...(unreadPages.length ? { unreadPages } : {}), ...(count(payload.refundedCredits) && payload.refundedCredits ? { refundedCredits: payload.refundedCredits } : {}),
        ...(malformedIssues ? { malformedIssues } : {}) } };
    }
  }
  return null;
}
