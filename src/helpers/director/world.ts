/**
 * What every Director request carries: the desktop's World projection (pipelineV3World.ts, change them together), seeded from what the writer
 * declared. It projects what checks already bought, locally and free: the cast becomes the entities, and the facts each chapter read lists become
 * found states and knowledge.
 *
 * Authority rule: the writer's pen outranks the machine. Writer-sourced states and knowledge, and entities with writer provenance, are never
 * touched; an entity any kept record names is never removed; and no found state is added where an open writer state holds that entity and dimension.
 * The result is built per request and never stored: canon.json stays the writer's alone.
 *
 * Identity: one entity per cast member, an existing one reused only through a proper name exactly one member and one entity of that type hold. Ids
 * are stable across rebuilds, so a pin made from a found fact keeps its record. Names are compared by key in any script. Pure.
 */
import { capKey, dimensionEntry, isKnowledgePolarity, parseDimensionKey, propositionKeyOf, topicKey, type CanonStability } from "@/helpers/canon/dimensions";
import { isPageSource, isWriterSource, MAX_ALIASES_PER_ENTITY, MAX_DIMENSION_CHARS, MAX_NAME_CHARS, MAX_PROPOSITION_CHARS, MAX_PROPOSITION_KEY_CHARS, MAX_VALUE_CHARS,
  type CanonAlias, type CanonEntity, type CanonKnowledge, type CanonSource, type CanonState, type CanonTracking, type PageSource } from "@/helpers/canon/record";
import { nameKey as subjectKey } from "@/helpers/world";
import type { CastKind, CastMember, ChapterRead, Fact } from "@/lib/contract/pipelineV3.types";
import { sha256 } from "@/utils/hash";

const MAX_PROVENANCE_PER_ENTITY = 500;
const MAX_QUOTE_CHARS = 2_000;

export type EngineEntity = CanonEntity;
type EngineAlias = CanonAlias;
type EngineSource = CanonSource;
type EnginePageSource = PageSource;
type EngineStateRecord = CanonState;
type EngineKnowledgeRecord = CanonKnowledge;

/** The whole bundle the engine's edge requires (engine TrackingFilesSchema). A book read only by v3 has no anchors, elapsed edges or POV pages. */
export interface EngineTracking {
  entities: { version: 1; entities: EngineEntity[] };
  timeline: { version: 1; anchors: unknown[]; states: EngineStateRecord[]; elapsed: unknown[] };
  knowledge: { version: 1; facts: EngineKnowledgeRecord[] };
  pov: { version: 1; pages: Record<string, unknown> };
}

/** A relationship's or possession's other party, from its dimension key. */
function dimensionSubject(dimension: string): string | null {
  const parsed = parseDimensionKey(dimension);
  return parsed && parsed.entry.param === "entity" ? parsed.param ?? null : null;
}

/** The engine requires a page source's quote. A promoted fact can have come from a page without one. */
function wirePage(source: PageSource): PageSource { return { ...source, quote: source.quote?.slice(0, MAX_QUOTE_CHARS) ?? "" }; }
function wireSource(source: CanonSource): CanonSource {
  if (isWriterSource(source)) return source.from ? { ...source, from: wirePage(source.from) } : source;
  return wirePage(source);
}

/** What the writer declared, in the bundle's shape. The pen's own records, untouched otherwise. */
export function seedTracking(canon: CanonTracking): EngineTracking {
  return {
    entities: { version: 1, entities: canon.entities.entities.map((entity) => ({ ...entity, provenance: entity.provenance.map(wireSource) })) },
    timeline: { version: 1, anchors: [], elapsed: [], states: canon.timeline.states.map((state) => ({ ...state, openedAt: wireSource(state.openedAt), ...(state.closedAt ? { closedAt: wireSource(state.closedAt) } : {}) })) },
    knowledge: { version: 1, facts: canon.knowledge.facts.map((fact) => ({ ...fact, learnedAt: wireSource(fact.learnedAt) })) },
    pov: { version: 1, pages: {} },
  };
}

export interface PipelineV3WorldInput {
  tracking: EngineTracking;
  /** The book's cast from the last v3 review (v3-cast.json). */
  cast: readonly CastMember[];
  /** Every current chapter read (v3-reads.json, for the pages' current revisions). */
  reads: readonly ChapterRead[];
  /** Current story order of every page in the book (a cached read keeps the order it was read at). */
  pageOrder: ReadonlyMap<string, number>;
}

/** The engine's cast never groups `group` records (cast.ts), so organizations only ever come from v2 or the writer. */
const ENTITY_TYPE: Record<CastKind, string> = {
  person: "character", place: "location", building: "location", vessel: "object", animal: "object", object: "object", group: "organization",
};
/** Entity types a v3 cast can name: a found entity of another type is never v3's to remove. */
const V3_TYPES = new Set(["character", "location", "object"]);

/** Fact kinds whose `other` property holds until the text changes it (the vocabulary decides every other key). */
const LASTING_KINDS = new Set<Fact["kind"]>(["trait", "age_date_duration", "relationship", "death"]);

/**
 * Fact kinds an `other` fact may carry into the World: properties that last (a trait, a tie, a death, an object's
 * state, a date). A clock time, a count, a movement or a name is not a property of the world: live (Nine Fathoms) they
 * filled cards with rows like "predicted slack-water time", and names are already the entity's aliases.
 */
const OTHER_KINDS = new Set<Fact["kind"]>(["trait", "relationship", "death", "object_state", "age_date_duration"]);

const hashId = (family: "ent" | "st" | "kn", ...parts: string[]) => `${family}_v3_${sha256(parts.join("\u0000")).slice(0, 24)}`;
const clip = (text: string, max: number) => capKey(text.trim(), max);
const bucketKey = (entityId: string, dimension: string) => `${entityId}\u0000${dimension}`;

/** A record's page, when the record was found on one (writer and seed records have none). */
const pageOf = (source: EngineSource | null | undefined): string | undefined => (source && isPageSource(source) ? source.pageId : undefined);
const isWriter = (source: EngineSource | null | undefined): boolean => Boolean(source && isWriterSource(source));
const writerOwned = (entity: EngineEntity): boolean => entity.provenance.some(isWriter);

/**
 * A found fact the World can hold: said by the story itself as fact, with a value and a filed dimension. A plan, an
 * estimate, rhetoric, a rumour or something the text later corrects (`status`, from the state ledger) is context for
 * the engine's review, never a state of the world; reads before the tag carry no `status` and are facts.
 */
function worldFact(fact: Fact): boolean {
  if (fact.framing !== "narration" || fact.textMarksUntrue || (fact.status ?? "fact") !== "fact") return false;
  if (!fact.value?.trim() || !fact.dimension || fact.dimension === "none") return false;
  return fact.dimension !== "other" || OTHER_KINDS.has(fact.kind);
}

function stabilityOf(fact: Fact, dimension: string): CanonStability {
  // Found hair is dynamic, as v2 extraction recorded it: prose hair changes by choice. A writer pinning it declares it
  // stable (pinFact promotes a vocabulary key to its default).
  if (dimension === "appearance:hair") return "dynamic";
  const entry = dimensionEntry(dimension) ?? dimensionEntry(dimension.split(":")[0]);
  if (entry?.stability) return entry.stability;
  return LASTING_KINDS.has(fact.kind) ? "stable" : "dynamic";
}

const memberNames = (member: CastMember): string[] => [member.name, ...member.names, ...member.aliases, ...member.properNames];
/** Story order first, so the same cast always resolves the same way. */
const byFirstAppearance = (a: CastMember, b: CastMember) =>
  Math.min(...a.chapters, Infinity) - Math.min(...b.chapters, Infinity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

interface Candidate { entityId: string; dimension: string; value: string; stability: CanonStability; source: EnginePageSource; order: number; at: number; stateId: string }
type Entry = { kept: EngineStateRecord; order: number; at: number } | { fresh: Candidate; order: number; at: number };

export function projectPipelineV3World(input: PipelineV3WorldInput): EngineTracking {
  const { tracking, cast, reads, pageOrder } = input;
  const order = (read: ChapterRead) => pageOrder.get(read.pageId) ?? read.order;
  const sortedReads = [...reads].sort((a, b) => order(a) - order(b));
  const readPages = new Set(reads.map((read) => read.pageId));
  const source = (read: ChapterRead, quote: string): EnginePageSource => ({ pageId: read.pageId, pageOrder: order(read), rev: read.rev, quote: quote.slice(0, MAX_QUOTE_CHARS) });

  // What stays: every writer and seed record, and found records of pages this projection does not rebuild. A page no
  // longer in the book is rebuilt to nothing, so a deleted chapter's found records go with it.
  const rebuilt = (s: EngineSource | null | undefined) => { const page = pageOf(s); return page !== undefined && (readPages.has(page) || !pageOrder.has(page)); };
  const keptStates = tracking.timeline.states.filter((state) => !rebuilt(state.openedAt));
  const keptKnowledge = tracking.knowledge.facts.filter((fact) => !rebuilt(fact.learnedAt));

  // Entities. A writer's entity is left exactly as it is; a found one loses the provenance this projection rebuilds.
  const entities: EngineEntity[] = tracking.entities.entities.map((entity) => (writerOwned(entity) ? entity
    : { ...entity, aliases: [...entity.aliases], provenance: entity.provenance.filter((s) => !rebuilt(s)) }));
  const members = [...cast].sort(byFirstAppearance);
  const entityOf = identify(members, entities);

  // Who a name in a chapter is: the one cast member holding it; when several do, the one of the kind the chapter's own
  // cast record gives it, then the one the chapter belongs to. Still ambiguous: nobody (never a guess).
  const membersByName = new Map<string, CastMember[]>();
  for (const member of members) {
    for (const key of new Set(memberNames(member).map(subjectKey).filter(Boolean))) membersByName.set(key, [...(membersByName.get(key) ?? []), member]);
  }
  // `type`: the kind the caller knows (a cast record's own, or "character" for a fact only a person can have). Else the
  // chapter's records holding the name decide, only when they all agree on a kind.
  const resolve = (name: string | null | undefined, read: ChapterRead, type?: string): EngineEntity | undefined => {
    const key = name ? subjectKey(name) : "";
    let candidates = key ? membersByName.get(key) ?? [] : [];
    if (candidates.length > 1) {
      const kinds = new Set(read.cast.filter((r) => [r.name, ...r.names.map((n) => n.name)].some((n) => subjectKey(n) === key)).map((r) => ENTITY_TYPE[r.kind]));
      const want = type ?? (kinds.size === 1 ? [...kinds][0] : undefined);
      const typed = want ? candidates.filter((m) => ENTITY_TYPE[m.kind] === want) : [];
      if (typed.length) candidates = typed;
    }
    if (candidates.length > 1) {
      const here = candidates.filter((m) => m.chapters.includes(read.order));
      if (here.length) candidates = here;
    }
    return candidates.length === 1 ? entityOf.get(candidates[0]) : undefined;
  };

  // A found entity's names and page stamps (one per chapter it appears in, quoting a fact about it there, else the
  // name used). A writer's entity gains neither.
  for (const [member, entity] of entityOf) if (!writerOwned(entity)) entity.aliases = aliasesOf(entity, member);
  for (const read of sortedReads) {
    const stamped = new Set<string>();
    for (const record of read.cast) {
      const type = ENTITY_TYPE[record.kind];
      const entity = resolve(record.name, read, type) ?? record.names.map((n) => resolve(n.name, read, type)).find(Boolean);
      if (!entity || writerOwned(entity) || stamped.has(entity.entityId)) continue;
      stamped.add(entity.entityId);
      const fact = read.facts.find((f) => resolve(f.subject, read) === entity);
      entity.provenance.push(source(read, fact?.quote ?? record.name));
    }
  }
  for (const entity of entities) if (!writerOwned(entity) && entity.provenance.length > MAX_PROVENANCE_PER_ENTITY) entity.provenance.splice(MAX_PROVENANCE_PER_ENTITY);

  // Found states and knowledge from the facts, in story order.
  const keptIds = new Set([...keptStates.map((s) => s.stateId), ...keptKnowledge.map((k) => k.knowledgeId)]);
  const writerOpen = new Set(keptStates.filter((s) => isWriter(s.openedAt) && !s.closedAt).map((s) => bucketKey(s.entityId, s.dimension)));
  const writerKnowledge = new Set(keptKnowledge.filter((k) => isWriter(k.learnedAt)).map((k) => `${k.entityId}\u0000${k.propositionKey}`));
  const candidates: Candidate[] = [];
  const knowledge: EngineKnowledgeRecord[] = [];
  const knownKeys = new Set<string>();
  for (const read of sortedReads) {
    for (const fact of read.facts) {
      if (!worldFact(fact)) continue;
      const entity = resolve(fact.subject, read, personOnly(fact.dimension) ? "character" : undefined);
      if (!entity) continue;
      if (isKnowledgePolarity(fact.dimension)) {
        const proposition = clip(fact.value!, MAX_PROPOSITION_CHARS);
        const propositionKey = propositionKeyOf(proposition, MAX_PROPOSITION_KEY_CHARS);
        const knower = `${entity.entityId}\u0000${propositionKey}`;
        const knowledgeId = hashId("kn", read.pageId, read.rev, entity.entityId, fact.dimension, propositionKey, fact.quote);
        if (!propositionKey || writerKnowledge.has(knower) || knownKeys.has(`${knower}\u0000${fact.dimension}`) || keptIds.has(knowledgeId)) continue;
        knownKeys.add(`${knower}\u0000${fact.dimension}`);
        knowledge.push({ knowledgeId, entityId: entity.entityId, proposition, propositionKey, polarity: fact.dimension, learnedAt: source(read, fact.quote) });
        continue;
      }
      const dimension = dimensionFor(fact, entity, (name) => resolve(name, read));
      if (!dimension || writerOpen.has(bucketKey(entity.entityId, dimension))) continue;
      const value = clip(fact.value!, MAX_VALUE_CHARS);
      const stateId = hashId("st", read.pageId, read.rev, entity.entityId, dimension, subjectKey(value), fact.quote);
      if (keptIds.has(stateId) || candidates.some((c) => c.stateId === stateId)) continue;
      candidates.push({ entityId: entity.entityId, dimension, value, stability: stabilityOf(fact, dimension), source: source(read, fact.quote),
        order: order(read), at: fact.span.start, stateId });
    }
  }
  const { states, rewritten } = mergeBuckets(candidates, keptStates, writerOpen, rebuilt, (page, fallback) => pageOrder.get(page) ?? fallback);
  const allStates = [...keptStates.map((s) => rewritten.get(s.stateId) ?? s), ...states];
  const allKnowledge = [...keptKnowledge, ...knowledge];

  // An entity goes only when nothing names it any more: no provenance left, no record about it or naming it as the
  // other party, and of a type a v3 cast could have named.
  const referenced = new Set<string>();
  for (const s of allStates) { referenced.add(s.entityId); const other = dimensionSubject(s.dimension); if (other) referenced.add(other); }
  for (const k of allKnowledge) referenced.add(k.entityId);
  const liveEntities = entities.filter((entity) => entity.provenance.length > 0 || referenced.has(entity.entityId) || !V3_TYPES.has(entity.type));

  return {
    ...tracking,
    entities: { ...tracking.entities, entities: liveEntities },
    timeline: { ...tracking.timeline, states: allStates },
    knowledge: { ...tracking.knowledge, facts: allKnowledge },
  };
}

/**
 * Each cast member's entity. An existing active entity is reused through a proper name (its canonical name or a
 * greppable alias) that exactly one member and exactly one entity of that type hold; an entity two members claim goes
 * to the one whose name it bears, else the one in more chapters. Everyone else gets a new entity whose id hashes its
 * type and name (salted when two share one), which the next rebuild finds again by that id.
 */
function identify(members: readonly CastMember[], entities: EngineEntity[]): Map<CastMember, EngineEntity> {
  const typed = (type: string, key: string) => `${type}\u0000${key}`;
  const properKeys = (entity: EngineEntity) => new Set([entity.canonicalName, ...entity.aliases.filter((a) => a.grep).map((a) => a.text)].map(subjectKey).filter(Boolean));
  const entitiesByKey = new Map<string, EngineEntity[]>();
  for (const entity of entities) {
    if (entity.status !== "active") continue;
    for (const key of properKeys(entity)) entitiesByKey.set(typed(entity.type, key), [...(entitiesByKey.get(typed(entity.type, key)) ?? []), entity]);
  }
  const memberProper = (member: CastMember) => new Set(member.properNames.map(subjectKey).filter(Boolean));
  const holders = new Map<string, number>();
  for (const member of members) for (const key of memberProper(member)) holders.set(typed(ENTITY_TYPE[member.kind], key), (holders.get(typed(ENTITY_TYPE[member.kind], key)) ?? 0) + 1);

  const claims = new Map<EngineEntity, CastMember[]>();
  for (const member of members) {
    const type = ENTITY_TYPE[member.kind];
    const found = new Set<EngineEntity>();
    for (const key of memberProper(member)) {
      const matches = entitiesByKey.get(typed(type, key)) ?? [];
      if (holders.get(typed(type, key)) === 1 && matches.length === 1) found.add(matches[0]);
    }
    const entity = found.size === 1 ? [...found][0] : [...found].find((e) => subjectKey(e.canonicalName) === subjectKey(member.name));
    if (entity) claims.set(entity, [...(claims.get(entity) ?? []), member]);
  }
  const entityOf = new Map<CastMember, EngineEntity>();
  const taken = new Set<EngineEntity>();
  for (const [entity, claimants] of claims) {
    const winner = claimants.find((m) => subjectKey(m.name) === subjectKey(entity.canonicalName))
      ?? [...claimants].sort((a, b) => b.chapters.length - a.chapters.length || byFirstAppearance(a, b))[0];
    entityOf.set(winner, entity);
    taken.add(entity);
  }
  // A new entity's id hashes its type and name; two members sharing a name are told apart by each one's own set of
  // names, never by cast order (which moves when a namesake appears earlier). The entity already under that id is
  // reused even when the writer has touched it (a pin stamps it): found records attach to it without changing it.
  const byId = new Map(entities.map((e) => [e.entityId, e]));
  const nameOf = (member: CastMember) => clip(member.properNames[0] ?? member.name, MAX_NAME_CHARS);
  const sharing = new Map<string, number>();
  for (const member of members) {
    if (entityOf.has(member)) continue;
    const k = typed(ENTITY_TYPE[member.kind], subjectKey(nameOf(member)));
    sharing.set(k, (sharing.get(k) ?? 0) + 1);
  }
  for (const member of members) {
    if (entityOf.has(member)) continue;
    const type = ENTITY_TYPE[member.kind];
    const name = nameOf(member);
    const shared = (sharing.get(typed(type, subjectKey(name))) ?? 0) > 1;
    const own = shared ? [...new Set(memberNames(member).map(subjectKey).filter(Boolean))].sort().join("\u0001") : "";
    let entity: EngineEntity | undefined;
    for (let salt = 0; !entity; salt++) {
      const id = hashId("ent", type, subjectKey(name), ...(own ? [own] : []), ...(salt ? [String(salt)] : []));
      const existing = byId.get(id);
      if (!existing) {
        entity = { entityId: id, canonicalName: name, type, aliases: [], status: "active", provenance: [] };
        entities.push(entity);
        byId.set(id, entity);
      } else if (!taken.has(existing) && existing.type === type) entity = existing;
    }
    entityOf.set(member, entity);
    taken.add(entity);
  }
  return entityOf;
}

/**
 * A found entity's aliases, rebuilt from its member's names on every projection (proper names greppable, descriptions
 * not), so a name an earlier cast merged in by mistake does not stay. A writer's entity is never passed here.
 */
function aliasesOf(entity: EngineEntity, member: CastMember): EngineAlias[] {
  const proper = new Set(member.properNames.map(subjectKey));
  const known = new Set([subjectKey(entity.canonicalName)]);
  const aliases: EngineAlias[] = [];
  for (const name of new Set(memberNames(member))) {
    const key = subjectKey(name);
    if (!key || known.has(key) || aliases.length >= MAX_ALIASES_PER_ENTITY) continue;
    aliases.push({ text: clip(name, MAX_NAME_CHARS), kind: proper.has(key) ? "full_name" : "epithet", grep: proper.has(key) });
    known.add(key);
  }
  return aliases;
}

/** Dimensions only a person has: a name two members share is read as the person's for these. */
function personOnly(dimension: string | undefined): boolean {
  return Boolean(dimension && (dimension.startsWith("appearance:") || isKnowledgePolarity(dimension)
    || ["trait", "motivation", "voice", "relationship", "stance"].includes(dimension)));
}

/**
 * One bucket per entity and dimension, the kept found records of other pages included: a changing state is closed
 * where the next one opens (a kept one is reclosed, or reopened when what closed it was rebuilt away); a lasting one
 * keeps its first value (a later different value is a continuity finding, not a fact of the world). A bucket an open
 * writer state holds is left alone.
 */
function mergeBuckets(
  candidates: readonly Candidate[], keptStates: readonly EngineStateRecord[], writerOpen: ReadonlySet<string>,
  rebuilt: (source: EngineSource | null | undefined) => boolean, orderOf: (pageId: string, fallback: number) => number,
): { states: EngineStateRecord[]; rewritten: Map<string, EngineStateRecord> } {
  const keptFound = new Map<string, EngineStateRecord[]>();
  for (const state of keptStates) {
    if (isWriter(state.openedAt)) continue;
    const key = bucketKey(state.entityId, state.dimension);
    keptFound.set(key, [...(keptFound.get(key) ?? []), state]);
  }
  const fresh = new Map<string, Candidate[]>();
  for (const c of candidates) fresh.set(bucketKey(c.entityId, c.dimension), [...(fresh.get(bucketKey(c.entityId, c.dimension)) ?? []), c]);
  const touched = new Set([...fresh.keys(), ...[...keptFound].filter(([, states]) => states.some((s) => rebuilt(s.closedAt))).map(([key]) => key)]);

  const states: EngineStateRecord[] = [];
  const rewritten = new Map<string, EngineStateRecord>();
  const keptOrder = (s: EngineStateRecord) => (isPageSource(s.openedAt) ? orderOf(s.openedAt.pageId, s.openedAt.pageOrder) : -1);
  for (const key of touched) {
    if (writerOpen.has(key)) continue;
    const entries: Entry[] = [
      ...(keptFound.get(key) ?? []).map((kept) => ({ kept, order: keptOrder(kept), at: -1 })),
      ...(fresh.get(key) ?? []).map((c) => ({ fresh: c, order: c.order, at: c.at })),
    ].sort((a, b) => a.order - b.order || a.at - b.at);
    const stabilityOfEntry = (e: Entry) => ("kept" in e ? e.kept.stability : e.fresh.stability);
    const valueOf = (e: Entry) => ("kept" in e ? e.kept.value : e.fresh.value);
    const openedAt = (e: Entry): EngineSource => ("kept" in e ? e.kept.openedAt : e.fresh.source);
    const toState = (c: Candidate, closedAt: EngineSource | null): EngineStateRecord =>
      ({ stateId: c.stateId, entityId: c.entityId, dimension: c.dimension, value: c.value, stability: c.stability, openedAt: c.source, closedAt });

    if (stabilityOfEntry(entries[0]) === "stable") {
      // A lasting property keeps the value that stands: an earlier reading's open record (reopened if what closed it
      // was rebuilt away) stays alone; otherwise the first found value is added.
      let keptOpen = false;
      for (const e of entries) {
        if (!("kept" in e)) continue;
        if (e.kept.closedAt && rebuilt(e.kept.closedAt)) rewritten.set(e.kept.stateId, { ...e.kept, closedAt: null });
        if (!e.kept.closedAt || rebuilt(e.kept.closedAt)) keptOpen = true;
      }
      const first = entries.find((e): e is Extract<Entry, { fresh: Candidate }> => "fresh" in e);
      if (!keptOpen && first) states.push(toState(first.fresh, null));
      continue;
    }
    // A fresh repeat of the value already standing adds nothing; kept records are never dropped.
    const changes = entries.filter((e, i) => i === 0 || "kept" in e || subjectKey(valueOf(e)) !== subjectKey(valueOf(entries[i - 1])));
    changes.forEach((e, i) => {
      const closedAt = changes[i + 1] ? openedAt(changes[i + 1]) : null;
      if ("fresh" in e) { states.push(toState(e.fresh, closedAt)); return; }
      if (JSON.stringify(e.kept.closedAt ?? null) !== JSON.stringify(closedAt)) rewritten.set(e.kept.stateId, { ...e.kept, closedAt });
    });
  }
  return { states, rewritten };
}

/**
 * The dimension a found fact is filed under: the vocabulary key itself; relationship and possession take the
 * counterpart's entity id (skipped when the cast does not know the counterpart, when it is the subject itself, or when
 * a possession names a person rather than a thing); stance takes the attribute as a topic key; `other` is the
 * attribute's key (the World tab labels it by humanising it).
 */
function dimensionFor(fact: Fact, subject: EngineEntity, entityFor: (name: string | null | undefined) => EngineEntity | undefined): string | undefined {
  const key = fact.dimension;
  if (!key) return undefined;
  if (key === "relationship" || key === "possession") {
    const other = entityFor(fact.counterpart);
    if (!other || other.entityId === subject.entityId || (key === "possession" && other.type === "character")) return undefined;
    return `${key}:${other.entityId}`;
  }
  if (key === "stance") { const topic = topicKey(fact.attribute); return topic ? capKey(`stance:${topic}`, MAX_DIMENSION_CHARS) : undefined; }
  if (key === "other") { const own = topicKey(fact.attribute); return own ? capKey(own, MAX_DIMENSION_CHARS) : undefined; }
  return key;
}
