/**
 * The World as the writer sees it: what checks found, with what they declared over it (desktop getCanon.usecase.ts). The writer's
 * pen outranks the machine: a found row is not shown where an open declaration holds that person and dimension. Rows are never
 * grouped by origin: the face and the verb say which is which. Pure.
 *
 * A record entity meets a cast member only through a name exactly one of each holds, never through a description both could carry
 * or a guess. When that fails they stay two cards, and the writer can see it. Names compare by the pen's own identity, in any script.
 */
import { dimensionLabel, parseDimensionKey, propositionKeyOf } from "@/helpers/canon/dimensions";
import { dimensionSubject, type CanonTarget, type EntityRef, type FoundEntity } from "@/helpers/canon/pen";
import { isDesktopMintedId } from "@/helpers/canon/ids";
import { isWriterSource, MAX_PROPOSITION_KEY_CHARS, nfcKey, type CanonEntity, type CanonKnowledge, type CanonSource, type CanonState, type CanonTracking, type PageSource } from "@/helpers/canon/record";
import { tierOf, type WorldEntity, type WorldEntityType, type WorldRow, type WorldTier } from "@/helpers/world";

export type PenVerb = "Make canon" | "Revert" | "Edit";

export interface RecordRow {
  id: string;
  origin: "found" | "canon";
  label: string;
  value: string;
  /** `canon · you · from 01 Arrival` or `canon · you · 12 mar`. Null on a found row, whose warrant is its passage. */
  mark: string | null;
  verb: PenVerb;
  /** The passage, on a found row. */
  found: WorldRow | null;
  /** Echoed back on Revert, Edit and Remove. Null on a found row. */
  target: CanonTarget | null;
  earlier: boolean;
}

export interface RecordEntity {
  /** The card's key: the cast id when a check found them, else the record's. */
  id: string;
  canonId: string | null;
  ref: EntityRef;
  name: string;
  type: WorldEntityType;
  aliases: string[];
  scenes: number;
  tier: WorldTier;
  rows: RecordRow[];
  writerTouched: boolean;
  /** Pages a check found them on: what Remove answers with. */
  pages: number;
}

export type Coordinate = (pageId: string) => string | null;

const typed = (type: string, key: string): string => `${type}\u0000${key}`;

/** Which cast member each record entity is, where exactly one of each holds a name of the same kind. */
export function linkEntities(world: readonly WorldEntity[], tracking: CanonTracking): Map<string, WorldEntity> {
  const memberKeys = (member: WorldEntity): string[] => [...new Set([member.name, ...member.properNames].map(nfcKey).filter(Boolean))];
  const holders = new Map<string, WorldEntity[]>();
  for (const member of world) for (const key of memberKeys(member)) holders.set(typed(member.type, key), [...(holders.get(typed(member.type, key)) ?? []), member]);
  const entityKeys = (entity: CanonEntity): string[] => [...new Set([entity.canonicalName, ...entity.aliases.filter((a) => a.grep).map((a) => a.text)].map(nfcKey).filter(Boolean))];
  const claimedBy = new Map<string, string[]>();
  const active = tracking.entities.entities.filter((entity) => entity.status === "active");
  for (const entity of active) for (const key of entityKeys(entity)) claimedBy.set(typed(entity.type, key), [...(claimedBy.get(typed(entity.type, key)) ?? []), entity.entityId]);

  const links = new Map<string, WorldEntity>();
  const taken = new Set<string>();
  for (const entity of active) {
    const matches = entityKeys(entity).flatMap((key) => {
      const members = holders.get(typed(entity.type, key)) ?? [];
      return members.length === 1 && claimedBy.get(typed(entity.type, key))?.length === 1 ? members : [];
    });
    const unique = [...new Set(matches)];
    const member = unique.length === 1 ? unique[0] : unique.find((m) => nfcKey(m.name) === nfcKey(entity.canonicalName));
    if (member && !taken.has(member.id)) { links.set(entity.entityId, member); taken.add(member.id); }
  }
  return links;
}

const shortDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? null : when.toLocaleDateString(undefined, { day: "numeric", month: "short" }).toLocaleLowerCase();
};

/** `canon · you · from 01 Arrival` when it keeps its page, else the declaration's date. */
export function canonMark(source: CanonSource | null | undefined, coordinate: Coordinate): string {
  const writer = isWriterSource(source) ? source : null;
  const from = writer?.from ? coordinate(writer.from.pageId) : null;
  if (from) return `canon · you · from ${from}`;
  const date = shortDate(writer?.declaredAt);
  return date ? `canon · you · ${date}` : "canon · you";
}

const human = (raw: string): string => { const spaced = raw.replace(/_/gu, " "); const [first = ""] = spaced; return first.toLocaleUpperCase() + spaced.slice(first.length); };

/** A dimension's label, the other party named. Never an id. */
export function dimensionLabelFor(dimension: string, nameOf: (entityId: string) => string | null): string {
  const subject = dimensionSubject(dimension);
  const detailLabel = subject ? nameOf(subject) ?? undefined : undefined;
  if (subject && !detailLabel) return parseDimensionKey(dimension)?.entry.label ?? human(dimension);
  return dimensionLabel(dimension, { detailLabel, fallback: human });
}

const stateRow = (state: CanonState, nameOf: (entityId: string) => string | null, coordinate: Coordinate): RecordRow => {
  const promoted = isWriterSource(state.openedAt) && Boolean(state.openedAt.from);
  return { id: state.stateId, origin: "canon", label: dimensionLabelFor(state.dimension, nameOf), value: state.value, mark: canonMark(state.openedAt, coordinate), verb: promoted ? "Revert" : "Edit", found: null, earlier: false,
    target: { kind: "state", stateId: state.stateId, entityId: state.entityId, dimension: state.dimension, value: state.value } };
};
const knowledgeRow = (fact: CanonKnowledge, coordinate: Coordinate): RecordRow => {
  const promoted = isWriterSource(fact.learnedAt) && Boolean(fact.learnedAt.from);
  return { id: fact.knowledgeId, origin: "canon", label: dimensionLabel(fact.polarity, { fallback: human }), value: fact.proposition, mark: canonMark(fact.learnedAt, coordinate), verb: promoted ? "Revert" : "Edit", found: null, earlier: false,
    target: { kind: "knowledge", knowledgeId: fact.knowledgeId, entityId: fact.entityId, proposition: fact.proposition, polarity: fact.polarity } };
};

const pageOrderOf = (source: CanonSource): number => (isWriterSource(source) && source.from ? source.from.pageOrder : Infinity);

/** Merges what checks found with what the writer declared. Found rows keep their place, a promoted fact takes its page's, and what was typed by hand comes last. */
export function mergeRecord(world: readonly WorldEntity[], tracking: CanonTracking, coordinate: Coordinate): RecordEntity[] {
  const links = linkEntities(world, tracking);
  const canonOfMember = new Map([...links].map(([canonId, member]) => [member.id, canonId]));
  const canonById = new Map(tracking.entities.entities.filter((e) => e.status === "active").map((e) => [e.entityId, e]));
  const nameOf = (entityId: string): string | null => canonById.get(entityId)?.canonicalName ?? null;
  const open = tracking.timeline.states.filter((state) => !state.closedAt && isWriterSource(state.openedAt));
  const knowledge = tracking.knowledge.facts.filter((fact) => isWriterSource(fact.learnedAt));

  const build = (canon: CanonEntity | null, member: WorldEntity | null): RecordEntity => {
    const canonId = canon?.entityId ?? null;
    const held = new Set(open.filter((s) => s.entityId === canonId).map((s) => s.dimension));
    const declaredKnowledge = new Set(knowledge.filter((k) => k.entityId === canonId).map((k) => k.propositionKey));
    const found = (member?.rows ?? []).filter((row) => {
      if (row.polarity) return !declaredKnowledge.has(propositionKeyOf(row.value, MAX_PROPOSITION_KEY_CHARS));
      const other = row.counterpart ? canonOfMember.get(row.counterpart) : null;
      return !held.has(row.family && other ? `${row.family}:${other}` : row.dimension);
    }).map((row): RecordRow => ({ id: row.key, origin: "found", label: row.label, value: row.value, mark: null, verb: "Make canon", found: row, target: null, earlier: row.earlier }));
    const placed = [...found.map((row, at) => ({ row, order: row.found?.order ?? Infinity, at }))];
    let at = placed.length;
    for (const state of open.filter((s) => s.entityId === canonId)) placed.push({ row: stateRow(state, nameOf, coordinate), order: pageOrderOf(state.openedAt), at: at++ });
    for (const fact of knowledge.filter((k) => k.entityId === canonId)) placed.push({ row: knowledgeRow(fact, coordinate), order: pageOrderOf(fact.learnedAt), at: at++ });
    const rows = placed.sort((a, b) => a.order - b.order || a.at - b.at).map((entry) => entry.row);

    const name = canon?.canonicalName ?? member?.name ?? "";
    const aliases = [...new Map([...(canon?.aliases.map((a) => a.text) ?? []), ...(member?.aliases ?? []), ...(canon && member ? [member.name] : [])]
      .filter((text) => nfcKey(text) !== nfcKey(name)).map((text) => [nfcKey(text) || text, text])).values()];
    const scenes = member?.scenes ?? 0;
    const type = (canon?.type ?? member?.type ?? "character") as WorldEntityType;
    const writerTouched = Boolean(canon) && (isDesktopMintedId(canon?.entityId ?? "") || (canon?.provenance.some(isWriterSource) ?? false));
    const ref: EntityRef = canonId ? { canonId } : { found: foundOf(member as WorldEntity, null) };
    return { id: member?.id ?? canonId ?? "", canonId, ref, name, type, aliases, scenes, tier: member?.tier ?? tierOf(scenes), rows, writerTouched, pages: scenes };
  };

  const merged = world.map((member) => { const canonId = canonOfMember.get(member.id) ?? null; return build(canonId ? canonById.get(canonId) ?? null : null, member); });
  for (const entity of canonById.values()) if (!links.has(entity.entityId)) merged.push(build(entity, null));
  return merged;
}

function foundOf(member: WorldEntity, canonId: string | null): FoundEntity {
  const row = member.rows.find((r) => !r.earlier) ?? member.rows[0];
  const page: PageSource | null = row ? { pageId: row.pageId, pageOrder: row.order, rev: row.rev, quote: row.quote } : null;
  return { worldId: member.id, canonId, name: member.name, type: member.type, names: [...member.aliases, ...member.properNames], page, pages: member.scenes, sample: row ? { pageId: row.pageId, quote: row.quote } : null };
}

/** Everyone a check found, as the pen's identity check and its writes need them. */
export function foundEntities(world: readonly WorldEntity[], tracking: CanonTracking): FoundEntity[] {
  const links = linkEntities(world, tracking);
  const canonOfMember = new Map([...links].map(([canonId, member]) => [member.id, canonId]));
  return world.map((member) => foundOf(member, canonOfMember.get(member.id) ?? null));
}

