/**
 * The World tab, from what a check already bought (desktop pipelineV3World.ts, without the writer's pen): the cast becomes
 * the entities, and the facts each read lists, filed under the shared vocabulary with their values, become what the World
 * says about them. No extra credits and no extra call.
 *
 * Reads structure only (dimensions, names as keys, story order), so it holds in every language. A name that could belong to
 * two people resolves to nobody, never to a guess.
 */
import type { CastKind, CastMember, ChapterRead, Fact } from "@/lib/contract/pipelineV3.types";

export type WorldEntityType = "character" | "location" | "object" | "organization";
export type WorldTier = "main" | "supporting" | "mentioned";

export interface WorldRow {
  key: string;
  label: string;
  value: string;
  quote: string;
  pageId: string;
  start: number;
  end: number;
  /** A changing state a later passage replaced, such as where someone was. */
  earlier: boolean;
}

export interface WorldEntity {
  id: string;
  name: string;
  type: WorldEntityType;
  aliases: string[];
  /** Pages the book's cast places them on. */
  scenes: number;
  tier: WorldTier;
  rows: WorldRow[];
}

const ENTITY_TYPE: Record<CastKind, WorldEntityType> = {
  person: "character", place: "location", building: "location", vessel: "object", animal: "object", object: "object", group: "organization",
};

/** Desktop helpers.ts significanceTier. */
const MAIN_MIN = 5;
const SUPPORTING_MIN = 2;
const tierOf = (scenes: number): WorldTier => (scenes >= MAIN_MIN ? "main" : scenes >= SUPPORTING_MIN ? "supporting" : "mentioned");

/** The vocabulary's labels (desktop shared/canon/dimensions.ts) and whether a found value stands or can change. */
const VOCABULARY: Readonly<Record<string, { label: string; lasting: boolean }>> = {
  "appearance:eye_color": { label: "Eye colour", lasting: true },
  // Prose hair changes by choice, so found hair can change, as on desktop.
  "appearance:hair": { label: "Hair", lasting: false },
  "appearance:build": { label: "Build", lasting: true },
  "appearance:age": { label: "Age", lasting: true },
  "appearance:height": { label: "Height", lasting: true },
  "appearance:distinguishing_mark": { label: "Distinguishing mark", lasting: true },
  trait: { label: "Personality trait", lasting: true },
  motivation: { label: "Motivation", lasting: true },
  voice: { label: "Voice", lasting: true },
  location: { label: "Location", lasting: false },
  injury: { label: "Injury", lasting: false },
  possession: { label: "Possession of", lasting: false },
  relationship: { label: "Relationship with", lasting: true },
  stance: { label: "Stance on", lasting: true },
  knows: { label: "Knows", lasting: true },
  suspects: { label: "Suspects", lasting: true },
  believes_false: { label: "Believes false", lasting: true },
  unaware: { label: "Unaware of", lasting: true },
};
const KNOWLEDGE = new Set(["knows", "suspects", "believes_false", "unaware"]);
const PERSON_ONLY = new Set(["trait", "motivation", "voice", "relationship", "stance", ...KNOWLEDGE]);

/** Kinds of `other` fact that are properties of the world. A clock time, a count or a movement is not. */
const OTHER_KINDS = new Set<Fact["kind"]>(["trait", "relationship", "death", "object_state", "age_date_duration"]);
const LASTING_KINDS = new Set<Fact["kind"]>(["trait", "age_date_duration", "relationship", "death"]);

/** Mirrors the engine's `nameKey`: what a fact's subject and a cast name are compared by. */
export const nameKey = (name: string): string => name.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
const topicKey = (raw: string): string => raw.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, "_");
const capFirst = (text: string): string => { const [first = ""] = text; return first.toLocaleUpperCase() + text.slice(first.length); };
const human = (key: string): string => capFirst(key.replace(/_/gu, " "));

/** Said by the story itself as fact, with a value and a filed dimension. A plan, a rumour or a corrected claim is not the world. */
function worldFact(fact: Fact): boolean {
  if (fact.framing !== "narration" || fact.textMarksUntrue || (fact.status ?? "fact") !== "fact") return false;
  if (!fact.value?.trim() || !fact.dimension || fact.dimension === "none") return false;
  return fact.dimension !== "other" || OTHER_KINDS.has(fact.kind);
}

const memberNames = (member: CastMember): string[] => [member.name, ...member.names, ...member.aliases, ...member.properNames];
const firstAppearance = (a: CastMember, b: CastMember): number =>
  Math.min(...a.chapters, Infinity) - Math.min(...b.chapters, Infinity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const personOnly = (dimension: string): boolean => dimension.startsWith("appearance:") || PERSON_ONLY.has(dimension);

export function projectWorld(cast: readonly CastMember[], reads: readonly ChapterRead[]): WorldEntity[] {
  const members = [...cast].sort(firstAppearance);
  const sorted = [...reads].sort((a, b) => a.order - b.order);
  const holders = new Map<string, CastMember[]>();
  for (const member of members) {
    for (const key of new Set(memberNames(member).map(nameKey).filter(Boolean))) holders.set(key, [...(holders.get(key) ?? []), member]);
  }

  // The one member holding a name. When several do: the kind the caller knows or this page's own records agree on, then the
  // one this page belongs to. Still ambiguous: nobody.
  const resolve = (name: string | null | undefined, read: ChapterRead, type?: WorldEntityType): CastMember | undefined => {
    const key = name ? nameKey(name) : "";
    let candidates = key ? holders.get(key) ?? [] : [];
    if (candidates.length > 1) {
      const kinds = new Set(read.cast.filter((r) => [r.name, ...r.names.map((n) => n.name)].some((n) => nameKey(n) === key)).map((r) => ENTITY_TYPE[r.kind]));
      const want = type ?? (kinds.size === 1 ? [...kinds][0] : undefined);
      const typed = want ? candidates.filter((m) => ENTITY_TYPE[m.kind] === want) : [];
      if (typed.length) candidates = typed;
    }
    if (candidates.length > 1) {
      const here = candidates.filter((m) => m.chapters.includes(read.order));
      if (here.length) candidates = here;
    }
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  const displayName = (member: CastMember): string => member.properNames[0] ?? member.name;
  const rows = new Map<string, Map<string, WorldRow[]>>(); // member id -> dimension -> rows in story order
  for (const read of sorted) {
    for (const fact of read.facts) {
      if (!worldFact(fact)) continue;
      const dimension = fact.dimension as string;
      const member = resolve(fact.subject, read, personOnly(dimension) ? "character" : undefined);
      if (!member) continue;
      const filed = fileUnder(fact, member, (name) => resolve(name, read), displayName);
      if (!filed) continue;
      const lasting = KNOWLEDGE.has(dimension) || (VOCABULARY[dimension]?.lasting ?? LASTING_KINDS.has(fact.kind));
      const buckets = rows.get(member.id) ?? new Map<string, WorldRow[]>();
      rows.set(member.id, buckets);
      const bucket = buckets.get(filed.key) ?? [];
      buckets.set(filed.key, bucket);
      const row: WorldRow = { key: `${filed.key}\u0000${read.pageId}\u0000${fact.span.start}`, label: filed.label, value: (fact.value as string).trim(), quote: fact.quote,
        pageId: read.pageId, start: fact.span.start, end: fact.span.end, earlier: false };
      const last = bucket[bucket.length - 1];
      // What lasts keeps its first value (a later different one is a finding, not the world). What changes records each change.
      if (!last) bucket.push(row);
      else if (!lasting && nameKey(last.value) !== nameKey(row.value)) { last.earlier = true; bucket.push(row); }
    }
  }

  return members.map((member) => {
    const scenes = new Set(member.chapters).size;
    const own = displayName(member);
    return {
      id: member.id, name: own, type: ENTITY_TYPE[member.kind], scenes, tier: tierOf(scenes),
      aliases: [...new Map(member.properNames.filter((name) => nameKey(name) !== nameKey(own)).map((name) => [nameKey(name), name])).values()],
      rows: [...(rows.get(member.id)?.values() ?? [])].flat(),
    };
  }).sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name));
}

/** The dimension a fact is filed under and its label, or nothing when it cannot be filed without guessing. */
function fileUnder(fact: Fact, subject: CastMember, memberFor: (name: string | null | undefined) => CastMember | undefined, displayName: (member: CastMember) => string): { key: string; label: string } | undefined {
  const key = fact.dimension as string;
  if (key === "relationship" || key === "possession") {
    const other = memberFor(fact.counterpart);
    if (!other || other.id === subject.id || (key === "possession" && ENTITY_TYPE[other.kind] === "character")) return undefined;
    return { key: `${key}:${other.id}`, label: `${VOCABULARY[key].label} ${displayName(other)}` };
  }
  if (key === "stance") {
    const topic = topicKey(fact.attribute);
    return topic ? { key: `stance:${topic}`, label: `${VOCABULARY.stance.label} ${fact.attribute.trim()}` } : undefined;
  }
  if (key === "other") {
    const own = topicKey(fact.attribute);
    return own ? { key: own, label: human(own) } : undefined;
  }
  if (KNOWLEDGE.has(key)) return { key: `${key}:${topicKey(fact.value as string)}`, label: VOCABULARY[key].label };
  return { key, label: VOCABULARY[key]?.label ?? human(key) };
}

export type WorldFilter = "people" | "places" | "things";
const FILTER_TYPES: Record<WorldFilter, readonly WorldEntityType[]> = { people: ["character"], places: ["location"], things: ["object", "organization"] };

/** Entities of a filter that match a search over names, labels and values. */
export function filterWorld(entities: readonly WorldEntity[], filter: WorldFilter, search: string): WorldEntity[] {
  const query = search.trim().toLocaleLowerCase();
  return entities.filter((entity) => FILTER_TYPES[filter].includes(entity.type)
    && (!query || [entity.name, ...entity.aliases, ...entity.rows.flatMap((r) => [r.label, r.value])].some((text) => text.toLocaleLowerCase().includes(query))));
}
