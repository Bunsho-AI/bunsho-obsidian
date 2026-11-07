/**
 * The canon pen: every way a writer declares, changes or withdraws a fact, ported from the desktop's use cases (canon/*.usecase.ts).
 * Pure and immutable: each takes the record and answers with a new one, or a typed refusal and the old one untouched. Saving is
 * the controller's.
 *
 * Found facts live in the reads here, not in this record, so two things differ from the desktop's file. A found entity joins the
 * record only when the writer touches it (`ensureEntity`). And Revert of a promoted fact removes the record: the found row was
 * never overwritten, and shows again from its read.
 *
 * Identity is NFC + trim + lowercase equality, never a Latin normaliser. Nothing here reads prose.
 */
import { buildDimensionKey, isCanonStability, isKnowledgePolarity, parseDimensionKey, propositionKeyOf, type CanonDimensionEntry, type CanonKnowledgePolarity, type CanonStability } from "@/helpers/canon/dimensions";
import { isDesktopMintedId, mintEntityId, mintKnowledgeId, mintStateId } from "@/helpers/canon/ids";
import {
  isPageSource, isWriterSource, MAX_ALIASES_PER_ENTITY, MAX_DIMENSION_CHARS, MAX_NAME_CHARS, MAX_PROPOSITION_CHARS, MAX_PROPOSITION_KEY_CHARS, MAX_VALUE_CHARS, nfcKey, penText,
  WRITER_ALIAS_KIND, WRITER_SOURCE_ORIGIN, withinLimit, writerSource,
  type CanonEntity, type CanonEntityType, type CanonKnowledge, type CanonSource, type CanonState, type CanonTracking, type PageSource, type WriterSource,
} from "@/helpers/canon/record";

export type PenFailureCode = "INVALID_INPUT" | "NOT_FOUND" | "STALE_TARGET" | "NOT_CANON" | "NOT_EDITABLE_PROMOTED" | "IDENTITY_AMBIGUOUS" | "DUPLICATE_DIMENSION" | "ENTITY_IN_USE" | "INTERNAL_ERROR";

/** Someone a check found, as the pen needs them. `canonId`: they are already in the record. */
export interface FoundEntity { worldId: string; canonId: string | null; name: string; type: string; names: readonly string[]; page: PageSource | null; pages: number; sample: { pageId: string; quote: string } | null }

/** Who a write is about: someone in the record, or someone a check found. Found ids move between checks, so they are resolved at write time. */
export type EntityRef = { canonId: string } | { found: FoundEntity };

export interface IdentityMatch { ref: EntityRef; canonicalName: string; type: string; sample: { pageId: string; quote: string } | null }
export type IdentityResolution = "alias_of_existing" | "new_entity";

export type PenFailure<D = unknown> = { success: false; code: PenFailureCode; error: string; match?: IdentityMatch; data?: D };
export type PenResult<T> = { success: true; data: T; tracking: CanonTracking; changed: boolean } | PenFailure;

export interface PenContext { now: string; found: readonly FoundEntity[] }

export type CanonTarget =
  | { kind: "state"; stateId: string; entityId: string; dimension: string; value: string }
  | { kind: "knowledge"; knowledgeId: string; entityId: string; proposition: string; polarity: string };

const refuse = (code: PenFailureCode, error: string, more: Pick<PenFailure, "match" | "data"> = {}): PenFailure => ({ success: false, code, error, ...more });
const done = <T>(tracking: CanonTracking, data: T, changed = true): PenResult<T> => ({ success: true, data, tracking, changed });

const active = (tracking: CanonTracking, entityId: string): CanonEntity | undefined => tracking.entities.entities.find((e) => e.entityId === entityId && e.status === "active");
const hasName = (names: readonly string[], text: string): boolean => { const key = nfcKey(text); return names.some((name) => nfcKey(name) === key); };
const namesOf = (entity: CanonEntity): string[] => [entity.canonicalName, ...entity.aliases.map((a) => a.text)];

const withEntities = (tracking: CanonTracking, entities: CanonEntity[]): CanonTracking => ({ ...tracking, entities: { ...tracking.entities, entities } });
const withStates = (tracking: CanonTracking, states: CanonState[]): CanonTracking => ({ ...tracking, timeline: { ...tracking.timeline, states } });
const withFacts = (tracking: CanonTracking, facts: CanonKnowledge[]): CanonTracking => ({ ...tracking, knowledge: { ...tracking.knowledge, facts } });
const replaceEntity = (tracking: CanonTracking, entityId: string, change: (entity: CanonEntity) => CanonEntity): CanonTracking =>
  withEntities(tracking, tracking.entities.entities.map((e) => (e.entityId === entityId ? change(e) : e)));

/** Exactly one writer entry in an entity's provenance. Keeps the earliest. */
export function stampWriterProvenance(entity: CanonEntity, now: string): CanonEntity {
  const writers = entity.provenance.filter(isWriterSource);
  if (writers.length === 1) return entity;
  if (writers.length === 0) return { ...entity, provenance: [...entity.provenance, writerSource(now)] };
  return { ...entity, provenance: entity.provenance.filter((s) => !isWriterSource(s) || s === writers[0]) };
}
const stamped = (tracking: CanonTracking, entityId: string, now: string): CanonTracking => replaceEntity(tracking, entityId, (e) => stampWriterProvenance(e, now));

/** Puts someone a check found into the record, once, under an id of the record's own. */
function ensureEntity(tracking: CanonTracking, ref: EntityRef, now: string): { tracking: CanonTracking; entityId: string } | null {
  if ("canonId" in ref) return active(tracking, ref.canonId) ? { tracking, entityId: ref.canonId } : null;
  const { found } = ref;
  if (found.canonId) return active(tracking, found.canonId) ? { tracking, entityId: found.canonId } : null;
  const entity: CanonEntity = { entityId: mintEntityId(), canonicalName: found.name.slice(0, MAX_NAME_CHARS), type: found.type, aliases: [], status: "active", provenance: [...(found.page ? [found.page] : []), writerSource(now)] };
  return { tracking: withEntities(tracking, [...tracking.entities.entities, entity]), entityId: entity.entityId };
}

/** The first active entity other than `exclude` holding this name. First in file order: the prompt asks about one. Found people count, as they do on the desktop. */
export function findIdentityMatch(tracking: CanonTracking, context: PenContext, text: string, exclude?: string): IdentityMatch | null {
  const foundOf = (canonId: string) => context.found.find((f) => f.canonId === canonId);
  for (const entity of tracking.entities.entities) {
    if (entity.status !== "active" || entity.entityId === exclude) continue;
    const found = foundOf(entity.entityId);
    if (hasName([...namesOf(entity), ...(found?.names ?? [])], text)) return { ref: { canonId: entity.entityId }, canonicalName: entity.canonicalName, type: entity.type, sample: found?.sample ?? null };
  }
  const found = context.found.find((f) => !f.canonId && hasName([f.name, ...f.names], text));
  return found ? { ref: { found }, canonicalName: found.name, type: found.type, sample: found.sample } : null;
}

function appendAlias(tracking: CanonTracking, entityId: string, text: string, now: string): PenResult<{ entityId: string; added: boolean }> {
  const entity = active(tracking, entityId);
  if (!entity) return refuse("NOT_FOUND", "That entity is no longer in the record");
  if (hasName(namesOf(entity), text)) return done(tracking, { entityId, added: false }, false);
  if (entity.aliases.length >= MAX_ALIASES_PER_ENTITY) return refuse("INVALID_INPUT", `${entity.canonicalName} already has ${MAX_ALIASES_PER_ENTITY} names, the most Bunsho can track`);
  return done(replaceEntity(tracking, entityId, (e) => stampWriterProvenance({ ...e, aliases: [...e.aliases, { text, kind: WRITER_ALIAS_KIND, grep: true }] }, now)), { entityId, added: true });
}

export interface AddAliasRequest { entity: EntityRef; text: unknown; resolution?: IdentityResolution; matched?: EntityRef }
export function addAlias(tracking: CanonTracking, context: PenContext, request: AddAliasRequest): PenResult<{ entityId: string; added: boolean }> {
  const text = penText(request.text);
  if (!text) return refuse("INVALID_INPUT", "An alias needs an entity and some text");
  if (!withinLimit(text, MAX_NAME_CHARS)) return refuse("INVALID_INPUT", `An alias can be at most ${MAX_NAME_CHARS} characters`);
  if (request.resolution === "alias_of_existing" && !request.matched) return refuse("INVALID_INPUT", "alias_of_existing needs the matched entity");
  const here = "canonId" in request.entity ? request.entity.canonId : request.entity.found.canonId ?? undefined;
  if (here && !active(tracking, here)) return refuse("NOT_FOUND", "That entity is no longer in the record");
  if (request.resolution === undefined) {
    const match = findIdentityMatch(tracking, context, text, here);
    if (match && !("found" in match.ref && "found" in request.entity && match.ref.found.worldId === request.entity.found.worldId)) {
      return refuse("IDENTITY_AMBIGUOUS", `"${text}" already names ${match.canonicalName}`, { match });
    }
  }
  const landOn = request.resolution === "alias_of_existing" && request.matched ? request.matched : request.entity;
  // A name a found person already carries changes nothing: nothing joins the record for it.
  const carried = "found" in landOn ? landOn.found : context.found.find((f) => f.canonId === landOn.canonId);
  if (carried && hasName([carried.name, ...carried.names], text)) return done(tracking, { entityId: "canonId" in landOn ? landOn.canonId : carried.canonId ?? "", added: false }, false);
  const ensured = ensureEntity(tracking, landOn, context.now);
  if (!ensured) return refuse("NOT_FOUND", "That entity is no longer in the record");
  return appendAlias(ensured.tracking, ensured.entityId, text, context.now);
}

const ENTITY_TYPES: ReadonlySet<string> = new Set<CanonEntityType>(["character", "location", "object", "organization"]);
export type AddEntityOutcome = { entityId: string; outcome: "created" | "aliased" | "already_present" };
export interface AddEntityRequest { canonicalName: unknown; type: unknown; aliases?: unknown; resolution?: IdentityResolution; matched?: EntityRef }

/** The composer's alias list, cleaned: trimmed, non-empty, within the name bound, deduped by exact text. */
export function cleanAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(penText).filter((text) => text && withinLimit(text, MAX_NAME_CHARS)))];
}

export function addEntity(tracking: CanonTracking, context: PenContext, request: AddEntityRequest): PenResult<AddEntityOutcome> {
  const name = penText(request.canonicalName);
  const aliases = cleanAliases(request.aliases);
  if (!name || typeof request.type !== "string" || !ENTITY_TYPES.has(request.type)) return refuse("INVALID_INPUT", "A new entity needs a name and a known type");
  if (!withinLimit(name, MAX_NAME_CHARS)) return refuse("INVALID_INPUT", `A name can be at most ${MAX_NAME_CHARS} characters`);
  if (request.resolution === "alias_of_existing" && !request.matched) return refuse("INVALID_INPUT", "alias_of_existing needs the matched entity");
  if (request.resolution === undefined) {
    const match = findIdentityMatch(tracking, context, name);
    if (match) return refuse("IDENTITY_AMBIGUOUS", `"${name}" already names ${match.canonicalName}`, { match });
  }
  if (request.resolution === "alias_of_existing" && request.matched) {
    const ensured = ensureEntity(tracking, request.matched, context.now);
    if (!ensured) return refuse("NOT_FOUND", "That entity is no longer in the record");
    const first = appendAlias(ensured.tracking, ensured.entityId, name, context.now);
    if (!first.success) return first;
    let next = first.tracking;
    let any = first.data.added;
    for (const alias of aliases) { const added = appendAlias(next, ensured.entityId, alias, context.now); if (added.success) { next = added.tracking; any ||= added.data.added; } }
    return any ? done(next, { entityId: ensured.entityId, outcome: first.data.added ? "aliased" : "already_present" })
      : done(tracking, { entityId: ensured.entityId, outcome: "already_present" }, false);
  }
  const entity: CanonEntity = { entityId: mintEntityId(), canonicalName: name, type: request.type, aliases: [], status: "active", provenance: [writerSource(context.now)] };
  let next = withEntities(tracking, [...tracking.entities.entities, entity]);
  for (const alias of aliases) { const added = appendAlias(next, entity.entityId, alias, context.now); if (added.success) next = added.tracking; }
  return done(next, { entityId: entity.entityId, outcome: "created" });
}

/** A vocabulary dimension, rebuilt canonically: a topic becomes its key, an entity id stays as it is. */
function validateDimension(raw: unknown): { dimension: string; entry: CanonDimensionEntry; paramEntityId: string | null } | PenFailure {
  const text = penText(raw);
  if (!text) return refuse("INVALID_INPUT", "A fact needs a dimension");
  if (!withinLimit(text, MAX_DIMENSION_CHARS)) return refuse("INVALID_INPUT", `A fact's dimension can be at most ${MAX_DIMENSION_CHARS} characters`);
  const parsed = parseDimensionKey(text);
  if (!parsed) return refuse("INVALID_INPUT", "That is not a dimension Bunsho knows");
  const dimension = buildDimensionKey(parsed.entry, parsed.param ?? undefined);
  if (!dimension || !withinLimit(dimension, MAX_DIMENSION_CHARS)) return refuse("INVALID_INPUT", "That dimension needs its subject");
  return { dimension, entry: parsed.entry, paramEntityId: parsed.entry.param === "entity" ? parsed.param : null };
}
const isFailure = (value: object): value is PenFailure => "success" in value && value.success === false;

function validateValue(raw: unknown): string | PenFailure {
  const value = penText(raw);
  if (!value) return refuse("INVALID_INPUT", "A fact needs a value");
  return withinLimit(value, MAX_VALUE_CHARS) ? value : refuse("INVALID_INPUT", `A fact can be at most ${MAX_VALUE_CHARS} characters`);
}

function validateKnowledge(polarity: unknown, raw: unknown): { polarity: CanonKnowledgePolarity; proposition: string; propositionKey: string } | PenFailure {
  const proposition = penText(raw);
  if (!proposition) return refuse("INVALID_INPUT", "A knowledge fact needs a proposition");
  if (!isKnowledgePolarity(polarity)) return refuse("INVALID_INPUT", "A knowledge fact needs a polarity: knows, suspects, believes false or unaware");
  if (!withinLimit(proposition, MAX_PROPOSITION_CHARS)) return refuse("INVALID_INPUT", `A proposition can be at most ${MAX_PROPOSITION_CHARS} characters`);
  return { polarity, proposition, propositionKey: propositionKeyOf(proposition, MAX_PROPOSITION_KEY_CHARS) };
}

export type HandFact =
  /** `dimension` is the key, or the family when `counterpart` names the other party. `from`: the same fact is already found on this page, so declaring it pins it. */
  | { kind: "state"; dimension: unknown; value: unknown; stability?: unknown; counterpart?: EntityRef; from?: PageSource }
  | { kind: "knowledge"; polarity: unknown; proposition: unknown; from?: PageSource };
export type AddFactOutcome = { kind: "state" | "knowledge"; id: string; outcome: "created" | "pinned" | "unchanged" };

export function addFact(tracking: CanonTracking, context: PenContext, request: { entity: EntityRef; fact: HandFact }): PenResult<AddFactOutcome> {
  const { fact } = request;
  if (fact.kind !== "state" && fact.kind !== "knowledge") return refuse("INVALID_INPUT", "A fact needs a kind: state or knowledge");
  const ensured = ensureEntity(tracking, request.entity, context.now);
  if (!ensured) return refuse("NOT_FOUND", "That entity is no longer in the record");
  let next = ensured.tracking;
  const { entityId } = ensured;

  if (fact.kind === "knowledge") {
    const valid = validateKnowledge(fact.polarity, fact.proposition);
    if (isFailure(valid)) return valid;
    const key = nfcKey(valid.proposition);
    const existing = next.knowledge.facts.find((f) => f.entityId === entityId && f.polarity === valid.polarity && nfcKey(f.proposition) === key);
    if (existing) return done(tracking, { kind: "knowledge", id: existing.knowledgeId, outcome: "unchanged" }, false);
    const knowledgeId = mintKnowledgeId();
    next = withFacts(next, [...next.knowledge.facts, { knowledgeId, entityId, ...valid, learnedAt: writerSource(context.now, fact.from) }]);
    return done(stamped(next, entityId, context.now), { kind: "knowledge", id: knowledgeId, outcome: fact.from ? "pinned" : "created" });
  }

  let rawDimension = fact.dimension;
  if (fact.counterpart) {
    const other = ensureEntity(next, fact.counterpart, context.now);
    if (!other) return refuse("INVALID_INPUT", "That dimension names an entity that is not in the record");
    if (other.entityId === entityId) return refuse("INVALID_INPUT", "That dimension names the entity itself");
    next = other.tracking;
    rawDimension = `${penText(fact.dimension)}:${other.entityId}`;
  }
  const dimension = validateDimension(rawDimension);
  if (isFailure(dimension)) return dimension;
  if (dimension.paramEntityId && !active(next, dimension.paramEntityId)) return refuse("INVALID_INPUT", "That dimension names an entity that is not in the record");
  const value = validateValue(fact.value);
  if (typeof value !== "string") return value;
  if (fact.stability !== undefined && !isCanonStability(fact.stability)) return refuse("INVALID_INPUT", "A fact is either stable or dynamic");
  const stability: CanonStability = fact.stability ?? dimension.entry.stability ?? "stable";
  const existing = next.timeline.states.find((s) => s.entityId === entityId && !s.closedAt && nfcKey(s.dimension) === nfcKey(dimension.dimension) && nfcKey(s.value) === nfcKey(value));
  if (existing) return done(tracking, { kind: "state", id: existing.stateId, outcome: "unchanged" }, false);
  const stateId = mintStateId();
  next = withStates(next, [...next.timeline.states, { stateId, entityId, dimension: dimension.dimension, value, stability, openedAt: writerSource(context.now, fact.from), closedAt: null }]);
  return done(stamped(next, entityId, context.now), { kind: "state", id: stateId, outcome: fact.from ? "pinned" : "created" });
}

export type FoundFact =
  | { kind: "state"; dimension: string; value: string; stability: string; counterpart?: EntityRef; from: PageSource }
  | { kind: "knowledge"; polarity: string; proposition: string; from: PageSource };

/**
 * "Make canon" on what a check found. Nothing about the fact changes except that a vocabulary key the vocabulary calls stable is
 * declared stable, so Check canon and every review check it. A dynamic fact (a location) stays dynamic and makes no pin: it is
 * canon that no check tests, which is the desktop's gap too. Pinning again is a no-op.
 */
export function pinFound(tracking: CanonTracking, context: PenContext, request: { entity: EntityRef; fact: FoundFact }): PenResult<{ id: string; declaredAt: string }> {
  const { fact } = request;
  const ensured = ensureEntity(tracking, request.entity, context.now);
  if (!ensured) return refuse("STALE_TARGET", "That fact changed since it was shown — reloading");
  let next = ensured.tracking;
  const { entityId } = ensured;
  if (fact.kind === "knowledge") {
    const existing = next.knowledge.facts.find((f) => f.entityId === entityId && f.polarity === fact.polarity && f.proposition === fact.proposition);
    if (existing && isWriterSource(existing.learnedAt)) return done(tracking, { id: existing.knowledgeId, declaredAt: existing.learnedAt.declaredAt }, false);
    const knowledgeId = mintKnowledgeId();
    next = withFacts(next, [...next.knowledge.facts, { knowledgeId, entityId, polarity: fact.polarity, proposition: fact.proposition, propositionKey: propositionKeyOf(fact.proposition, MAX_PROPOSITION_KEY_CHARS), learnedAt: writerSource(context.now, fact.from) }]);
    return done(stamped(next, entityId, context.now), { id: knowledgeId, declaredAt: context.now });
  }
  let { dimension } = fact;
  if (fact.counterpart) {
    const other = ensureEntity(next, fact.counterpart, context.now);
    if (!other) return refuse("STALE_TARGET", "That fact changed since it was shown — reloading");
    next = other.tracking;
    dimension = `${fact.dimension}:${other.entityId}`;
  }
  const existing = next.timeline.states.find((s) => s.entityId === entityId && !s.closedAt && s.dimension === dimension && s.value === fact.value);
  if (existing && isWriterSource(existing.openedAt)) return done(tracking, { id: existing.stateId, declaredAt: existing.openedAt.declaredAt }, false);
  const stateId = mintStateId();
  const stability = parseDimensionKey(dimension)?.entry.stability === "stable" ? "stable" : fact.stability;
  next = withStates(next, [...next.timeline.states, { stateId, entityId, dimension, value: fact.value, stability, openedAt: writerSource(context.now, fact.from), closedAt: null }]);
  return done(stamped(next, entityId, context.now), { id: stateId, declaredAt: context.now });
}

type Located = { kind: "state"; record: CanonState; source: WriterSource } | { kind: "knowledge"; record: CanonKnowledge; source: WriterSource };

/** The record a target names, matched by id and every field the writer saw: ids can outlive what they meant. */
function locate(tracking: CanonTracking, target: CanonTarget): Located | "stale" | "not_canon" {
  const check = <R>(record: R | undefined, source: (r: R) => CanonSource, build: (r: R, s: WriterSource) => Located): Located | "stale" | "not_canon" => {
    if (!record) return "stale";
    const from = source(record);
    return isWriterSource(from) ? build(record, from) : "not_canon";
  };
  if (target.kind === "state") {
    const state = tracking.timeline.states.find((s) => s.stateId === target.stateId && !s.closedAt && s.entityId === target.entityId && s.dimension === target.dimension && s.value === target.value);
    return check(state, (s) => s.openedAt, (record, source) => ({ kind: "state", record, source }));
  }
  const fact = tracking.knowledge.facts.find((f) => f.knowledgeId === target.knowledgeId && f.entityId === target.entityId && f.proposition === target.proposition && f.polarity === target.polarity);
  return check(fact, (f) => f.learnedAt, (record, source) => ({ kind: "knowledge", record, source }));
}

const withdraw = (tracking: CanonTracking, located: Located, entityId: string, now: string): PenResult<{ outcome: "restored" | "removed" }> => {
  const next = located.kind === "state" ? withStates(tracking, tracking.timeline.states.filter((s) => s !== located.record)) : withFacts(tracking, tracking.knowledge.facts.filter((f) => f !== located.record));
  return done(active(next, entityId) ? stamped(next, entityId, now) : next, { outcome: located.source.from ? "restored" : "removed" });
};

/** Revert: a promoted fact goes back to being found, a hand-typed one goes. A row that is no longer canon is stale, whichever way it stopped being. */
export function unpinFact(tracking: CanonTracking, context: PenContext, target: CanonTarget): PenResult<{ outcome: "restored" | "removed" }> {
  const located = locate(tracking, target);
  if (located === "stale") return refuse("STALE_TARGET", "That fact changed since it was shown — reloading");
  if (located === "not_canon") return refuse("STALE_TARGET", "That fact is not canon any more — reloading");
  return withdraw(tracking, located, target.entityId, context.now);
}

/** Remove, from the edit state: one path with Revert. */
export function removeFact(tracking: CanonTracking, context: PenContext, target: CanonTarget): PenResult<{ outcome: "restored" | "removed" }> {
  const located = locate(tracking, target);
  if (located === "stale") return refuse("STALE_TARGET", "That fact changed since it was shown — reloading");
  if (located === "not_canon") return refuse("NOT_CANON", "Only facts you declared can be edited or removed");
  return withdraw(tracking, located, target.entityId, context.now);
}

export interface FactPatch { value?: unknown; dimension?: unknown; stability?: unknown; polarity?: unknown; proposition?: unknown }
const redeclared = (source: WriterSource, now: string): WriterSource => ({ ...source, origin: WRITER_SOURCE_ORIGIN, declaredAt: now });

/**
 * Edit changes a hand-typed fact in place and declares it again. A promoted fact has Revert instead: going back restores the
 * source only, so an edited one would return to "found" carrying the writer's words under a manuscript quote.
 */
export function editFact(tracking: CanonTracking, context: PenContext, target: CanonTarget, patch: FactPatch): PenResult<{ declaredAt: string; changed: boolean }> {
  if (target.kind === "state" && (patch.polarity !== undefined || patch.proposition !== undefined)) return refuse("INVALID_INPUT", "A state fact has no polarity or proposition");
  if (target.kind === "knowledge" && (patch.value !== undefined || patch.dimension !== undefined || patch.stability !== undefined)) return refuse("INVALID_INPUT", "A knowledge fact has no dimension, value or stability");
  const located = locate(tracking, target);
  if (located === "stale") return refuse("STALE_TARGET", "That fact changed since it was shown — reloading");
  if (located === "not_canon") return refuse("NOT_CANON", "Only facts you declared can be edited or removed");
  const { source } = located;
  if (source.from) return refuse("NOT_EDITABLE_PROMOTED", "This fact was read from the manuscript — revert it, or add one by hand");
  const unchanged = done(tracking, { declaredAt: source.declaredAt, changed: false }, false);
  const declared = redeclared(source, context.now);
  const answer = { declaredAt: context.now, changed: true };

  if (located.kind === "state") {
    const { record } = located;
    let { dimension } = record;
    if (patch.dimension !== undefined) {
      const valid = validateDimension(patch.dimension);
      if (isFailure(valid)) return valid;
      if (valid.paramEntityId && !active(tracking, valid.paramEntityId)) return refuse("INVALID_INPUT", "That dimension names an entity that is not in the record");
      ({ dimension } = valid);
      if (dimension !== record.dimension) {
        const other = tracking.timeline.states.find((s) => s.stateId !== record.stateId && s.entityId === record.entityId && !s.closedAt && s.dimension === dimension);
        if (other) return refuse("DUPLICATE_DIMENSION", "There is already an open fact on that dimension — edit that one instead", { data: { stateId: other.stateId } });
      }
    }
    const value = validateValue(patch.value ?? record.value);
    if (typeof value !== "string") return value;
    if (patch.stability !== undefined && !isCanonStability(patch.stability)) return refuse("INVALID_INPUT", "A fact is either stable or dynamic");
    const stability = (patch.stability as string | undefined) ?? record.stability;
    if (dimension === record.dimension && value === record.value && stability === record.stability) return unchanged;
    const next = withStates(tracking, tracking.timeline.states.map((s) => (s === record ? { ...s, dimension, value, stability, openedAt: declared } : s)));
    return done(stamped(next, record.entityId, context.now), answer);
  }
  const { record } = located;
  const valid = validateKnowledge(patch.polarity ?? record.polarity, patch.proposition ?? record.proposition);
  if (isFailure(valid)) return valid;
  const propositionChanged = valid.proposition !== record.proposition;
  if (valid.polarity === record.polarity && !propositionChanged) return unchanged;
  // The key is the proposition's: a polarity-only edit keeps it, and its grouping.
  const next = withFacts(tracking, tracking.knowledge.facts.map((f) => (f === record ? { ...f, polarity: valid.polarity, proposition: valid.proposition, propositionKey: propositionChanged ? valid.propositionKey : f.propositionKey, learnedAt: declared } : f)));
  return done(stamped(next, record.entityId, context.now), answer);
}

export interface RenameRequest { entity: EntityRef; canonicalName: unknown; resolution?: IdentityResolution }
/** The old name stays as an alias: the manuscript still says it. Every reference is by id, so nothing else moves. A rename never merges. */
export function renameEntity(tracking: CanonTracking, context: PenContext, request: RenameRequest): PenResult<{ entityId: string; canonicalName: string; outcome: "renamed" | "unchanged" }> {
  const name = penText(request.canonicalName);
  if (!name) return refuse("INVALID_INPUT", "A rename needs an entity and a new name");
  if (!withinLimit(name, MAX_NAME_CHARS)) return refuse("INVALID_INPUT", `A name can be at most ${MAX_NAME_CHARS} characters`);
  if (request.resolution === "alias_of_existing") return refuse("INVALID_INPUT", "A rename never merges two entities");
  const here = "canonId" in request.entity ? request.entity.canonId : request.entity.found.canonId;
  const current = here ? active(tracking, here) : null;
  if (here && !current) return refuse("NOT_FOUND", "That entity is no longer in the record");
  const oldName = current?.canonicalName ?? ("found" in request.entity ? request.entity.found.name : "");
  if (oldName === name) return done(tracking, { entityId: here ?? "", canonicalName: name, outcome: "unchanged" }, false);
  if (request.resolution === undefined) {
    const match = findIdentityMatch(tracking, context, name, here ?? undefined);
    const self = match && "found" in match.ref && "found" in request.entity && match.ref.found.worldId === request.entity.found.worldId;
    if (match && !self) return refuse("IDENTITY_AMBIGUOUS", `"${name}" already names ${match.canonicalName}`, { match });
  }
  const ensured = ensureEntity(tracking, request.entity, context.now);
  if (!ensured) return refuse("NOT_FOUND", "That entity is no longer in the record");
  const { entityId } = ensured;
  const key = nfcKey(name);
  const renamed = replaceEntity(ensured.tracking, entityId, (e) => ({ ...e, canonicalName: name, aliases: e.aliases.filter((a) => nfcKey(a.text) !== key) }));
  const aliased = appendAlias(renamed, entityId, oldName, context.now);
  if (!aliased.success) return aliased;
  return done(stamped(aliased.tracking, entityId, context.now), { entityId, canonicalName: name, outcome: "renamed" });
}

/** The entity id a relationship or possession dimension names, or null. */
export function dimensionSubject(dimension: string): string | null {
  const parsed = parseDimensionKey(dimension);
  return parsed && parsed.entry.param === "entity" ? parsed.param : null;
}

/** Manuscript pages behind an entity's declared facts: what a promoted fact, or a fact naming them, came from. Zero: declared by hand alone. */
export function declaredPagesFor(tracking: CanonTracking, entityId: string): number {
  const pages = new Set<string>();
  const add = (source: CanonSource | null | undefined): void => {
    if (isWriterSource(source)) { if (source.from) pages.add(source.from.pageId); } else if (isPageSource(source)) pages.add(source.pageId);
  };
  for (const state of tracking.timeline.states) if (state.entityId === entityId || dimensionSubject(state.dimension) === entityId) { add(state.openedAt); add(state.closedAt); }
  for (const fact of tracking.knowledge.facts) if (fact.entityId === entityId) add(fact.learnedAt);
  return pages.size;
}

/**
 * Deletes someone the writer added by hand and no check has found: with their facts, and the writer's facts naming them elsewhere, since
 * an id that names nobody would show raw for good. Anyone in the manuscript answers ENTITY_IN_USE with the page count: the prose still
 * says they exist, and the next read would find them again.
 */
export function removeEntity(tracking: CanonTracking, context: PenContext, entityId: string): PenResult<{ entityId: string; removedStates: number; removedKnowledge: number }> {
  const entity = active(tracking, entityId);
  if (!entity) return refuse("NOT_FOUND", "That entity is no longer in the record");
  const found = context.found.find((f) => f.canonId === entityId)?.pages ?? 0;
  const pages = Math.max(found, declaredPagesFor(tracking, entityId));
  if (!isDesktopMintedId(entityId) || pages > 0) {
    return refuse("ENTITY_IN_USE", pages > 0 ? `${entity.canonicalName} appears in the manuscript — Bunsho read them on ${pages} ${pages === 1 ? "page" : "pages"}` : `${entity.canonicalName} was read from the manuscript, not added by hand`, { data: { pages } });
  }
  const states = tracking.timeline.states.filter((s) => s.entityId !== entityId && dimensionSubject(s.dimension) !== entityId);
  const facts = tracking.knowledge.facts.filter((f) => f.entityId !== entityId);
  const next = withFacts(withStates(withEntities(tracking, tracking.entities.entities.filter((e) => e.entityId !== entityId)), states), facts);
  return done(next, { entityId, removedStates: tracking.timeline.states.length - states.length, removedKnowledge: tracking.knowledge.facts.length - facts.length });
}
