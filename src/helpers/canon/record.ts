/**
 * What the writer declared, in the desktop's record shapes (engine.types.ts), so a pin, a digest and a Director's tracking are
 * the same things they are there. Found facts are not stored here: they live in the reads, and a promoted record keeps the page
 * it came from as `from`. Pure.
 */
export const WRITER_SOURCE_ORIGIN = "writer";
export const WRITER_ALIAS_KIND = "nickname";

/** The engine's edge limits (desktop engine.constants.ts): one over-long field would fail every later check. */
export const MAX_NAME_CHARS = 200;
export const MAX_DIMENSION_CHARS = 200;
export const MAX_VALUE_CHARS = 2_000;
export const MAX_PROPOSITION_CHARS = 2_000;
export const MAX_PROPOSITION_KEY_CHARS = 300;
export const MAX_ALIASES_PER_ENTITY = 50;

export type CanonEntityType = "character" | "location" | "object" | "organization";

export interface PageSource { pageId: string; pageOrder: number; rev?: string; quote?: string }
export interface WriterSource { origin: typeof WRITER_SOURCE_ORIGIN; declaredAt: string; from?: PageSource }
export type CanonSource = PageSource | WriterSource;

export interface CanonAlias { text: string; kind: string; grep: boolean }
export interface CanonEntity { entityId: string; canonicalName: string; type: string; aliases: CanonAlias[]; status: string; provenance: CanonSource[] }
export interface CanonState { stateId: string; entityId: string; dimension: string; value: string; stability: string; openedAt: CanonSource; closedAt?: CanonSource | null }
export interface CanonKnowledge { knowledgeId: string; entityId: string; proposition: string; propositionKey: string; polarity: string; learnedAt: CanonSource }

/** The parts of the desktop's tracking bundle that hold a declaration. */
export interface CanonTracking {
  entities: { version: 1; entities: CanonEntity[] };
  timeline: { version: 1; states: CanonState[] };
  knowledge: { version: 1; facts: CanonKnowledge[] };
}

export const emptyCanon = (): CanonTracking => ({ entities: { version: 1, entities: [] }, timeline: { version: 1, states: [] }, knowledge: { version: 1, facts: [] } });

export const isWriterSource = (source: CanonSource | null | undefined): source is WriterSource => (source as WriterSource | null | undefined)?.origin === WRITER_SOURCE_ORIGIN;
export const isPageSource = (source: CanonSource | null | undefined): source is PageSource => typeof (source as PageSource | null | undefined)?.pageId === "string";

/** NFC-normalised, trimmed text: what gets stored. Empty when nothing usable was typed. */
export const penText = (raw: unknown): string => (typeof raw === "string" ? raw.normalize("NFC").trim() : "");
/** NFC + trim + lowercase: the identity and dedupe key. Never the Latin normaliser: every script keeps its names apart. */
export const nfcKey = (raw: string): string => raw.normalize("NFC").trim().toLowerCase();
export const withinLimit = (text: string, max: number): boolean => text.length > 0 && text.length <= max;

export const writerSource = (declaredAt: string, from?: PageSource): WriterSource =>
  (from ? { origin: WRITER_SOURCE_ORIGIN, declaredAt, from } : { origin: WRITER_SOURCE_ORIGIN, declaredAt });

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const MAX_ID_CHARS = 300;
const validPage = (value: unknown): value is PageSource => record(value) && text(value.pageId, MAX_ID_CHARS) && typeof value.pageOrder === "number" && (value.quote === undefined || typeof value.quote === "string") && (value.rev === undefined || typeof value.rev === "string");
const validWriter = (value: unknown): value is WriterSource => record(value) && value.origin === WRITER_SOURCE_ORIGIN && typeof value.declaredAt === "string" && (value.from === undefined || validPage(value.from));
const validSource = (value: unknown): value is CanonSource => validWriter(value) || validPage(value);
const validAlias = (value: unknown): value is CanonAlias => record(value) && text(value.text, MAX_NAME_CHARS) && typeof value.kind === "string" && typeof value.grep === "boolean";
const validEntity = (value: unknown): value is CanonEntity => record(value) && text(value.entityId, MAX_ID_CHARS) && text(value.canonicalName, MAX_NAME_CHARS) && typeof value.type === "string"
  && Array.isArray(value.aliases) && value.aliases.every(validAlias) && typeof value.status === "string" && Array.isArray(value.provenance) && value.provenance.every(validSource);
const validState = (value: unknown): value is CanonState => record(value) && text(value.stateId, MAX_ID_CHARS) && text(value.entityId, MAX_ID_CHARS) && text(value.dimension, MAX_DIMENSION_CHARS * 2)
  && text(value.value, MAX_VALUE_CHARS) && (value.stability === "stable" || value.stability === "dynamic") && validSource(value.openedAt) && (value.closedAt === undefined || value.closedAt === null || validSource(value.closedAt));
const validKnowledge = (value: unknown): value is CanonKnowledge => record(value) && text(value.knowledgeId, MAX_ID_CHARS) && text(value.entityId, MAX_ID_CHARS) && text(value.proposition, MAX_PROPOSITION_CHARS)
  && typeof value.propositionKey === "string" && typeof value.polarity === "string" && validSource(value.learnedAt);

/** The whole bundle, as the desktop's validTrackingBundle would take it. */
export function validTracking(value: unknown): value is CanonTracking {
  return record(value) && record(value.entities) && Array.isArray(value.entities.entities) && value.entities.entities.every(validEntity)
    && record(value.timeline) && Array.isArray(value.timeline.states) && value.timeline.states.every(validState)
    && record(value.knowledge) && Array.isArray(value.knowledge.facts) && value.knowledge.facts.every(validKnowledge);
}

/** A saved bundle, record by record. `dropped` counts what could not be kept, so the caller can keep a copy of the file. Null when it is no bundle at all. */
export function parseTracking(value: unknown): { tracking: CanonTracking; dropped: number } | null {
  if (!record(value) || !record(value.entities) || !Array.isArray(value.entities.entities) || !record(value.timeline) || !Array.isArray(value.timeline.states)
    || !record(value.knowledge) || !Array.isArray(value.knowledge.facts)) return null;
  const entities = value.entities.entities.filter(validEntity);
  const known = new Set(entities.map((entity) => entity.entityId));
  const states = value.timeline.states.filter(validState).filter((state) => known.has(state.entityId));
  const facts = value.knowledge.facts.filter(validKnowledge).filter((fact) => known.has(fact.entityId));
  const dropped = value.entities.entities.length - entities.length + value.timeline.states.length - states.length + value.knowledge.facts.length - facts.length;
  return { tracking: { entities: { version: 1, entities }, timeline: { version: 1, states }, knowledge: { version: 1, facts } }, dropped };
}
