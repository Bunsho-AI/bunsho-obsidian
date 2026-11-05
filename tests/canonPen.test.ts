/** The desktop's canonPen.test.ts and canonByHand.test.ts, over the pure reducers. Found facts come from the reads here, so a found entity is passed in. */
import { describe, expect, it } from "vitest";
import { MAX_PROPOSITION_KEY_CHARS, nfcKey, parseTracking, WRITER_ALIAS_KIND, type CanonTracking } from "@/helpers/canon/record";
import { addAlias, addEntity, addFact, declaredPagesFor, editFact, findIdentityMatch, pinFound, removeEntity, removeFact, renameEntity, stampWriterProvenance, unpinFact, type CanonTarget, type FoundEntity, type PenContext, type PenResult } from "@/helpers/canon/pen";
import { isDesktopMintedId, mintEntityId } from "@/helpers/canon/ids";

const NOW = "2026-11-05T10:00:00.000Z";
const LATER = "2026-11-06T10:00:00.000Z";
const SELMA = mintEntityId();
const ARVIND = mintEntityId();
const stamp = { origin: "writer" as const, declaredAt: "2026-01-01T00:00:00.000Z" };
const page = { pageId: "ch-1", pageOrder: 0, quote: "forty that spring" };
const base = (): CanonTracking => ({
  entities: { version: 1, entities: [
    { entityId: SELMA, canonicalName: "Selma Corver", type: "character", aliases: [{ text: "Sel", kind: WRITER_ALIAS_KIND, grep: true }], status: "active", provenance: [stamp] },
    { entityId: ARVIND, canonicalName: "Arvind Rao", type: "character", aliases: [], status: "active", provenance: [stamp] },
  ] },
  timeline: { version: 1, states: [
    { stateId: "st_voice", entityId: ARVIND, dimension: "voice", value: "dry", stability: "stable", openedAt: { ...stamp } },
    { stateId: "st_age", entityId: SELMA, dimension: "appearance:age", value: "forty", stability: "stable", openedAt: { ...stamp, from: page } },
  ] },
  knowledge: { version: 1, facts: [] },
});
const OFFICE: FoundEntity = { worldId: "r7", canonId: null, name: "The Harbour Office", type: "location", names: ["The Harbour Office", "the office"], page: { pageId: "ch-2", pageOrder: 1, quote: "at the office" }, pages: 2, sample: { pageId: "ch-2", quote: "at the office" } };
const ctx = (found: FoundEntity[] = [], now = NOW): PenContext => ({ now, found });
const ok = <T>(result: PenResult<T>): { data: T; tracking: CanonTracking } => { if (!result.success) throw new Error(JSON.stringify(result)); return { data: result.data, tracking: result.tracking }; };
const entity = (t: CanonTracking, id: string) => t.entities.entities.find((e) => e.entityId === id)!;
const VOICE: CanonTarget = { kind: "state", stateId: "st_voice", entityId: ARVIND, dimension: "voice", value: "dry" };
const AGE: CanonTarget = { kind: "state", stateId: "st_age", entityId: SELMA, dimension: "appearance:age", value: "forty" };

describe("Make canon, on what a check found", () => {
  const eyes = { kind: "state", dimension: "appearance:eye_color", value: "grey", stability: "stable", from: page } as const;

  it("declares it, keeping the page it came from, and stamps the entity", () => {
    const { data, tracking } = ok(pinFound(base(), ctx(), { entity: { canonId: SELMA }, fact: eyes }));
    const state = tracking.timeline.states.find((s) => s.stateId === data.id)!;
    expect(isDesktopMintedId(state.stateId)).toBe(true);
    expect(state.openedAt).toEqual({ origin: "writer", declaredAt: NOW, from: page });
    expect(entity(tracking, SELMA).provenance.filter((s) => "origin" in s)).toHaveLength(1);
  });

  it("brings someone a check found into the record, with an id of the record's own and never the cast's", () => {
    const { tracking } = ok(pinFound(base(), ctx(), { entity: { found: OFFICE }, fact: { ...eyes, dimension: "location" } }));
    const added = tracking.entities.entities.at(-1)!;
    expect(added.entityId).not.toContain("r7");
    expect(isDesktopMintedId(added.entityId)).toBe(true);
    expect(added).toMatchObject({ canonicalName: "The Harbour Office", type: "location", status: "active" });
    expect(added.provenance[0]).toEqual(OFFICE.page);
  });

  it("declares a found dynamic hair stable when pinned, but leaves a location dynamic", () => {
    const hair = ok(pinFound(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "appearance:hair", value: "black", stability: "dynamic", from: page } }));
    expect(hair.tracking.timeline.states.at(-1)!.stability).toBe("stable");
    const place = ok(pinFound(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "location", value: "the quay", stability: "dynamic", from: page } }));
    expect(place.tracking.timeline.states.at(-1)!.stability).toBe("dynamic");
  });

  it("files a relationship under the other party's record id", () => {
    const { tracking } = ok(pinFound(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "relationship", value: "sister", stability: "stable", counterpart: { canonId: ARVIND }, from: page } }));
    expect(tracking.timeline.states.at(-1)!.dimension).toBe(`relationship:${ARVIND}`);
  });

  it("pins knowledge through learnedAt", () => {
    const { tracking } = ok(pinFound(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "knowledge", polarity: "suspects", proposition: "the harbour deed is forged", from: page } }));
    expect(tracking.knowledge.facts[0]).toMatchObject({ polarity: "suspects", propositionKey: "the_harbour_deed_is_forged", learnedAt: { origin: "writer", from: page } });
  });

  it("is idempotent: a second press writes nothing", () => {
    const once = ok(pinFound(base(), ctx(), { entity: { canonId: SELMA }, fact: eyes })).tracking;
    const twice = pinFound(once, ctx([], LATER), { entity: { canonId: SELMA }, fact: eyes });
    expect(twice).toMatchObject({ success: true, changed: false, tracking: once });
  });

  it("refuses STALE_TARGET when who it is about has gone from the record", () => {
    expect(pinFound(base(), ctx(), { entity: { canonId: "ent_gone" }, fact: eyes })).toMatchObject({ success: false, code: "STALE_TARGET", error: "That fact changed since it was shown — reloading" });
  });

  it("leaves what it was given alone", () => {
    const before = base();
    const copy = structuredClone(before);
    pinFound(before, ctx(), { entity: { canonId: SELMA }, fact: eyes });
    expect(before).toEqual(copy);
  });
});

describe("Revert", () => {
  it("a promoted fact leaves the record, so its found row shows again", () => {
    const result = ok(unpinFact(base(), ctx(), AGE));
    expect(result.data.outcome).toBe("restored");
    expect(result.tracking.timeline.states.some((s) => s.stateId === "st_age")).toBe(false);
  });
  it("a hand-typed fact is removed", () => {
    expect(ok(unpinFact(base(), ctx(), VOICE)).data.outcome).toBe("removed");
  });
  it("refuses STALE_TARGET on a mismatch in any field, and writes nothing", () => {
    for (const target of [{ ...AGE, value: "fifty" }, { ...AGE, dimension: "appearance:hair" }, { ...AGE, entityId: ARVIND }, { ...AGE, stateId: "st_other" }] as CanonTarget[]) {
      expect(unpinFact(base(), ctx(), target)).toMatchObject({ success: false, code: "STALE_TARGET" });
    }
  });
  it("a row no longer canon on disk reads as stale, not an error", () => {
    const t = base();
    const found: CanonTracking = { ...t, timeline: { ...t.timeline, states: [{ ...t.timeline.states[0], openedAt: page }] } };
    expect(unpinFact(found, ctx(), VOICE)).toMatchObject({ code: "STALE_TARGET", error: "That fact is not canon any more — reloading" });
    expect(removeFact(found, ctx(), VOICE)).toMatchObject({ code: "NOT_CANON" });
  });
});

describe("the writer's stamp", () => {
  it("stays exactly one across repeated writes", () => {
    let { tracking } = ok(addAlias(base(), ctx(), { entity: { canonId: SELMA }, text: "One" }));
    ({ tracking } = ok(addAlias(tracking, ctx(), { entity: { canonId: SELMA }, text: "Two" })));
    expect(entity(tracking, SELMA).provenance).toHaveLength(1);
  });
  it("repairs a duplicate down to one, the earliest", () => {
    const e = { ...entity(base(), SELMA), provenance: [stamp, { ...stamp, declaredAt: LATER }] };
    expect(stampWriterProvenance(e, NOW).provenance).toEqual([stamp]);
    expect(stampWriterProvenance(e, NOW)).not.toBe(e);
  });
});

describe("Add alias", () => {
  it("appends {text, nickname, grep}, NFC-trimmed, dedupes by NFC key", () => {
    const { tracking } = ok(addAlias(base(), ctx(), { entity: { canonId: SELMA }, text: "  Café  " }));
    expect(entity(tracking, SELMA).aliases.at(-1)).toEqual({ text: "Café", kind: "nickname", grep: true });
    const again = addAlias(tracking, ctx(), { entity: { canonId: SELMA }, text: "café" });
    expect(again).toMatchObject({ success: true, changed: false, data: { added: false } });
  });
  it("keeps two different non-Latin aliases apart (no Latin-bound collapse)", () => {
    let { tracking } = ok(addAlias(base(), ctx(), { entity: { canonId: SELMA }, text: "セルマ" }));
    ({ tracking } = ok(addAlias(tracking, ctx(), { entity: { canonId: SELMA }, text: "セルマ・コーヴァー" })));
    const texts = entity(tracking, SELMA).aliases.map((a) => a.text);
    expect(texts).toContain("セルマ");
    expect(texts).toContain("セルマ・コーヴァー");
  });
  it("Arabic and Devanagari names are identified by what they are, not stripped to nothing", () => {
    const named = ok(addEntity(base(), ctx(), { canonicalName: "سلمى", type: "character" })).tracking;
    const hindi = ok(addEntity(named, ctx(), { canonicalName: "सलमा", type: "character" })).tracking;
    expect(hindi.entities.entities).toHaveLength(4);
    expect(addEntity(hindi, ctx(), { canonicalName: "  سلمى ", type: "character" })).toMatchObject({ code: "IDENTITY_AMBIGUOUS" });
    expect(addEntity(hindi, ctx(), { canonicalName: "सलमा", type: "character" })).toMatchObject({ code: "IDENTITY_AMBIGUOUS" });
    expect(addEntity(hindi, ctx(), { canonicalName: "ミラ", type: "character" })).toMatchObject({ success: true });
  });
  it("a composed and a decomposed name are one identity", () => {
    expect(nfcKey("Zoë")).toBe(nfcKey("Zoë"));
    const { tracking } = ok(addEntity(base(), ctx(), { canonicalName: "Zoë", type: "character" }));
    expect(addEntity(tracking, ctx(), { canonicalName: "ZOË", type: "character" })).toMatchObject({ code: "IDENTITY_AMBIGUOUS" });
  });
  it("asks, with the line it was read in, when the text names another entity", () => {
    const result = addAlias(base(), ctx([OFFICE]), { entity: { canonId: SELMA }, text: "THE OFFICE" });
    expect(result).toMatchObject({ code: "IDENTITY_AMBIGUOUS", match: { canonicalName: "The Harbour Office", type: "location", sample: { quote: "at the office" } } });
    expect(addAlias(base(), ctx(), { entity: { canonId: SELMA }, text: "Arvind Rao" })).toMatchObject({ code: "IDENTITY_AMBIGUOUS", match: { canonicalName: "Arvind Rao" } });
  });
  it("alias_of_existing attaches to the match; new_entity attaches where asked; nothing merges", () => {
    const linked = ok(addAlias(base(), ctx(), { entity: { canonId: SELMA }, text: "Arvind Rao", resolution: "new_entity" })).tracking;
    expect(entity(linked, SELMA).aliases.map((a) => a.text)).toContain("Arvind Rao");
    const other = ok(addAlias(base(), ctx(), { entity: { canonId: SELMA }, text: "Rao", resolution: "alias_of_existing", matched: { canonId: ARVIND } })).tracking;
    expect(entity(other, ARVIND).aliases.map((a) => a.text)).toEqual(["Rao"]);
    expect(other.entities.entities).toHaveLength(2);
  });
  it("mirrors the engine's name limit", () => {
    expect(addAlias(base(), ctx(), { entity: { canonId: SELMA }, text: "x".repeat(200) })).toMatchObject({ success: true });
    expect(addAlias(base(), ctx(), { entity: { canonId: SELMA }, text: "x".repeat(201) })).toMatchObject({ code: "INVALID_INPUT" });
  });
  it("mirrors the engine's alias limit: the 51st is refused", () => {
    let t = base();
    t = { ...t, entities: { ...t.entities, entities: t.entities.entities.map((e) => (e.entityId === SELMA ? { ...e, aliases: Array.from({ length: 50 }, (_, i) => ({ text: `a${i}`, kind: "nickname", grep: true })) } : e)) } };
    expect(addAlias(t, ctx(), { entity: { canonId: SELMA }, text: "one more" })).toMatchObject({ code: "INVALID_INPUT" });
  });
  it("refuses empty text and an unknown entity", () => {
    expect(addAlias(base(), ctx(), { entity: { canonId: SELMA }, text: "  " })).toMatchObject({ code: "INVALID_INPUT" });
    expect(addAlias(base(), ctx(), { entity: { canonId: "nobody" }, text: "x" })).toMatchObject({ code: "NOT_FOUND" });
    expect(addAlias(base(), ctx(), { entity: { canonId: SELMA }, text: "x", resolution: "alias_of_existing" })).toMatchObject({ code: "INVALID_INPUT" });
  });
  it("a found person's name they already carry brings nothing into the record", () => {
    const before = base();
    const result = addAlias(before, ctx([OFFICE]), { entity: { found: OFFICE }, text: "the office" });
    expect(result).toMatchObject({ success: true, data: { added: false } });
    expect((result as { tracking: CanonTracking }).tracking).toBe(before);
  });
});

describe("Add character", () => {
  it("mints our id, active, with the writer's stamp as sole provenance", () => {
    const { data, tracking } = ok(addEntity(base(), ctx(), { canonicalName: " Odile Marr ", type: "character" }));
    expect(data.outcome).toBe("created");
    expect(isDesktopMintedId(data.entityId)).toBe(true);
    expect(entity(tracking, data.entityId)).toEqual({ entityId: data.entityId, canonicalName: "Odile Marr", type: "character", aliases: [], status: "active", provenance: [{ origin: "writer", declaredAt: NOW }] });
  });
  it("records the aliases in one write; blanks, duplicates and the name itself are skipped", () => {
    const { data, tracking } = ok(addEntity(base(), ctx(), { canonicalName: "Odile Marr", type: "character", aliases: [" Odie ", "", "the ferrywoman", "Odie", "Odile Marr"] }));
    expect(entity(tracking, data.entityId).aliases).toEqual([{ text: "Odie", kind: "nickname", grep: true }, { text: "the ferrywoman", kind: "nickname", grep: true }]);
  });
  it("asks when the name is taken; alias_of_existing aliases it, new_entity creates anyway", () => {
    const asked = addEntity(base(), ctx(), { canonicalName: "sel", type: "character" });
    expect(asked).toMatchObject({ code: "IDENTITY_AMBIGUOUS" });
    expect(ok(addEntity(base(), ctx(), { canonicalName: "Selly", type: "character", resolution: "alias_of_existing", matched: { canonId: SELMA } })).data).toEqual({ entityId: SELMA, outcome: "aliased" });
    expect(ok(addEntity(base(), ctx(), { canonicalName: "Sel", type: "character", resolution: "new_entity" })).data.outcome).toBe("created");
  });
  it("alias_of_existing with a name the match already carries is already_present, and writes nothing", () => {
    expect(addEntity(base(), ctx(), { canonicalName: "Sel", type: "character", resolution: "alias_of_existing", matched: { canonId: SELMA } })).toMatchObject({ success: true, changed: false, data: { outcome: "already_present" } });
  });
  it("after alias_of_existing the typed aliases join the match too", () => {
    const { tracking } = ok(addEntity(base(), ctx(), { canonicalName: "Selma Corver", type: "character", aliases: ["Selmita"], resolution: "alias_of_existing", matched: { canonId: SELMA } }));
    expect(entity(tracking, SELMA).aliases.map((a) => a.text)).toContain("Selmita");
  });
  it("linking to someone found brings them into the record", () => {
    const { data, tracking } = ok(addEntity(base(), ctx([OFFICE]), { canonicalName: "HQ", type: "location", resolution: "alias_of_existing", matched: { found: OFFICE } }));
    expect(entity(tracking, data.entityId)).toMatchObject({ canonicalName: "The Harbour Office", aliases: [{ text: "HQ" }] });
  });
  it("mirrors the name limit, and refuses a bad type or an empty name", () => {
    expect(addEntity(base(), ctx(), { canonicalName: "n".repeat(201), type: "character" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(addEntity(base(), ctx(), { canonicalName: "x", type: "wizard" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(addEntity(base(), ctx(), { canonicalName: " ", type: "character" })).toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("Add a fact", () => {
  it("appends a writer state with our id and no `from`, stable by the vocabulary", () => {
    const { data, tracking } = ok(addFact(base(), ctx(), { entity: { canonId: ARVIND }, fact: { kind: "state", dimension: "appearance:height", value: " tall " } }));
    expect(data.outcome).toBe("created");
    expect(tracking.timeline.states.at(-1)).toMatchObject({ stateId: data.id, entityId: ARVIND, dimension: "appearance:height", value: "tall", stability: "stable", openedAt: { origin: "writer", declaredAt: NOW } });
    expect(tracking.timeline.states.at(-1)!.openedAt).not.toHaveProperty("from");
    expect(isDesktopMintedId(data.id)).toBe(true);
  });
  it("takes a passing condition as dynamic by default", () => {
    expect(ok(addFact(base(), ctx(), { entity: { canonId: ARVIND }, fact: { kind: "state", dimension: "location", value: "the quay" } })).tracking.timeline.states.at(-1)!.stability).toBe("dynamic");
  });
  it("writes a relationship keyed by the other party's id", () => {
    const { tracking } = ok(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "relationship", value: "sister of", counterpart: { canonId: ARVIND } } }));
    expect(tracking.timeline.states.at(-1)).toMatchObject({ dimension: `relationship:${ARVIND}`, stability: "stable" });
  });
  it("a relationship with someone found brings them into the record", () => {
    const { tracking } = ok(addFact(base(), ctx([OFFICE]), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "possession", value: "the key", counterpart: { found: OFFICE } } }));
    const added = tracking.entities.entities.at(-1)!;
    expect(tracking.timeline.states.at(-1)!.dimension).toBe(`possession:${added.entityId}`);
  });
  it("refuses a relationship whose other party is not in the record, or is themself", () => {
    expect(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "relationship:ent_nobody", value: "x" } })).toMatchObject({ code: "INVALID_INPUT" });
    expect(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "relationship", value: "x", counterpart: { canonId: SELMA } } })).toMatchObject({ code: "INVALID_INPUT" });
  });
  it("normalises a stance topic to its key in any script, and honours an explicit stability", () => {
    expect(ok(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "stance:The  Deed", value: "against", stability: "dynamic" } })).tracking.timeline.states.at(-1)).toMatchObject({ dimension: "stance:the_deed", stability: "dynamic" });
    expect(ok(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "stance:港の 権利書", value: "反対" } })).tracking.timeline.states.at(-1)!.dimension).toBe("stance:港の_権利書");
  });
  it("writes knowledge with a derived key, capped at the engine's bound while the proposition keeps its length", () => {
    const long = "the deed ".repeat(100);
    const { tracking } = ok(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "knowledge", polarity: "knows", proposition: long } }));
    const [fact] = tracking.knowledge.facts;
    expect(fact.propositionKey.length).toBeLessThanOrEqual(MAX_PROPOSITION_KEY_CHARS);
    expect(fact.proposition).toBe(long.trim());
    expect(fact.knowledgeId.startsWith("kn_")).toBe(true);
  });
  it("typing what is already found pins it, keeping its page", () => {
    const { data, tracking } = ok(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "appearance:eye_color", value: "grey", from: page } }));
    expect(data.outcome).toBe("pinned");
    expect(tracking.timeline.states.at(-1)!.openedAt).toMatchObject({ from: page });
  });
  it("the same fact twice is a no-op, whatever its case", () => {
    const { tracking } = ok(addFact(base(), ctx(), { entity: { canonId: ARVIND }, fact: { kind: "state", dimension: "voice", value: "DRY" } }));
    expect(tracking).toEqual(base());
  });
  it("refuses what the vocabulary cannot compose, and bad knowledge", () => {
    expect(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "shoe_size", value: "9" } })).toMatchObject({ code: "INVALID_INPUT" });
    expect(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "appearance:hair", value: " " } })).toMatchObject({ code: "INVALID_INPUT" });
    expect(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "appearance:hair", value: "v".repeat(2001) } })).toMatchObject({ code: "INVALID_INPUT" });
    expect(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "appearance:hair", value: "v", stability: "maybe" } })).toMatchObject({ code: "INVALID_INPUT" });
    expect(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "knowledge", polarity: "doubts", proposition: "x" } })).toMatchObject({ code: "INVALID_INPUT" });
    expect(addFact(base(), ctx(), { entity: { canonId: "nobody" }, fact: { kind: "state", dimension: "voice", value: "x" } })).toMatchObject({ code: "NOT_FOUND" });
    expect(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "wrong" } as never })).toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("Edit", () => {
  it("changes a hand-typed fact in place: same id and position, new value, declared again", () => {
    const { data, tracking } = ok(editFact(base(), ctx([], LATER), VOICE, { value: "gravel" }));
    expect(data).toEqual({ declaredAt: LATER, changed: true });
    expect(tracking.timeline.states[0]).toMatchObject({ stateId: "st_voice", value: "gravel", openedAt: { declaredAt: LATER } });
  });
  it("refuses a promoted fact, which has Revert instead", () => {
    expect(editFact(base(), ctx(), AGE, { value: "fifty" })).toMatchObject({ code: "NOT_EDITABLE_PROMOTED" });
  });
  it("re-dimensions through the vocabulary, and can change stability", () => {
    expect(ok(editFact(base(), ctx(), VOICE, { dimension: "stance:The Deed", stability: "dynamic" })).tracking.timeline.states[0]).toMatchObject({ dimension: "stance:the_deed", stability: "dynamic" });
    expect(editFact(base(), ctx(), VOICE, { dimension: "relationship:nobody" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(editFact(base(), ctx(), VOICE, { dimension: "made_up" })).toMatchObject({ code: "INVALID_INPUT" });
  });
  it("refuses DUPLICATE_DIMENSION, naming the record that holds it", () => {
    const t = ok(addFact(base(), ctx(), { entity: { canonId: ARVIND }, fact: { kind: "state", dimension: "trait", value: "calm" } }));
    expect(editFact(t.tracking, ctx(), VOICE, { dimension: "trait" })).toMatchObject({ code: "DUPLICATE_DIMENSION", data: { stateId: t.data.id } });
  });
  it("an edit that changes nothing writes nothing", () => {
    expect(editFact(base(), ctx([], LATER), VOICE, { value: " dry " })).toMatchObject({ success: true, changed: false, data: { changed: false } });
  });
  it("edits knowledge: a new proposition re-derives the key, a polarity alone keeps it", () => {
    const added = ok(addFact(base(), ctx(), { entity: { canonId: SELMA }, fact: { kind: "knowledge", polarity: "knows", proposition: "the deed" } }));
    const target: CanonTarget = { kind: "knowledge", knowledgeId: added.data.id, entityId: SELMA, proposition: "the deed", polarity: "knows" };
    expect(ok(editFact(added.tracking, ctx(), target, { polarity: "suspects" })).tracking.knowledge.facts[0]).toMatchObject({ polarity: "suspects", propositionKey: "the_deed" });
    expect(ok(editFact(added.tracking, ctx(), target, { proposition: "港" })).tracking.knowledge.facts[0]).toMatchObject({ proposition: "港", propositionKey: "港" });
    expect(editFact(added.tracking, ctx(), target, { value: "x" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(editFact(base(), ctx(), VOICE, { proposition: "x" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(editFact(base(), ctx(), { ...VOICE, value: "gone" } as CanonTarget, { value: "x" })).toMatchObject({ code: "STALE_TARGET" });
  });
});

describe("Rename", () => {
  it("moves the old name to an alias, so it stays findable, and never merges", () => {
    const { data, tracking } = ok(renameEntity(base(), ctx(), { entity: { canonId: SELMA }, canonicalName: " Selma Corver-Rao " }));
    expect(data).toEqual({ entityId: SELMA, canonicalName: "Selma Corver-Rao", outcome: "renamed" });
    expect(entity(tracking, SELMA).aliases).toContainEqual({ text: "Selma Corver", kind: "nickname", grep: true });
  });
  it("renames someone found: they join the record under the new name, with the old as an alias", () => {
    const { data, tracking } = ok(renameEntity(base(), ctx([OFFICE]), { entity: { found: OFFICE }, canonicalName: "Port Authority" }));
    expect(entity(tracking, data.entityId)).toMatchObject({ canonicalName: "Port Authority", aliases: [{ text: "The Harbour Office" }] });
  });
  it("a name that was their own alias stops being one", () => {
    const { tracking } = ok(renameEntity(base(), ctx(), { entity: { canonId: SELMA }, canonicalName: "Sel" }));
    expect(entity(tracking, SELMA).aliases.map((a) => a.text)).toEqual(["Selma Corver"]);
  });
  it("asks when the new name is another's; new_entity proceeds; alias_of_existing is refused", () => {
    expect(renameEntity(base(), ctx(), { entity: { canonId: SELMA }, canonicalName: "Arvind Rao" })).toMatchObject({ code: "IDENTITY_AMBIGUOUS" });
    expect(renameEntity(base(), ctx(), { entity: { canonId: SELMA }, canonicalName: "Arvind Rao", resolution: "new_entity" })).toMatchObject({ success: true });
    expect(renameEntity(base(), ctx(), { entity: { canonId: SELMA }, canonicalName: "Arvind Rao", resolution: "alias_of_existing" })).toMatchObject({ code: "INVALID_INPUT" });
  });
  it("the same name writes nothing; bad input is refused", () => {
    expect(renameEntity(base(), ctx(), { entity: { canonId: SELMA }, canonicalName: "Selma Corver" })).toMatchObject({ success: true, changed: false, data: { outcome: "unchanged" } });
    expect(renameEntity(base(), ctx(), { entity: { canonId: "nobody" }, canonicalName: "x" })).toMatchObject({ code: "NOT_FOUND" });
    expect(renameEntity(base(), ctx(), { entity: { canonId: SELMA }, canonicalName: "n".repeat(201) })).toMatchObject({ code: "INVALID_INPUT" });
    expect(renameEntity(base(), ctx(), { entity: { canonId: SELMA }, canonicalName: "  " })).toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("Remove character", () => {
  const added = () => ok(addEntity(base(), ctx(), { canonicalName: "Odile", type: "character" }));
  it("deletes someone hand-added, with their facts and the writer's facts naming them elsewhere", () => {
    const { data, tracking } = added();
    const id = data.entityId;
    let t = ok(addFact(tracking, ctx(), { entity: { canonId: id }, fact: { kind: "state", dimension: "voice", value: "low" } })).tracking;
    t = ok(addFact(t, ctx(), { entity: { canonId: id }, fact: { kind: "knowledge", polarity: "knows", proposition: "x" } })).tracking;
    t = ok(addFact(t, ctx(), { entity: { canonId: SELMA }, fact: { kind: "state", dimension: "relationship", value: "friend", counterpart: { canonId: id } } })).tracking;
    const removed = ok(removeEntity(t, ctx(), id));
    expect(removed.data).toEqual({ entityId: id, removedStates: 2, removedKnowledge: 1 });
    expect(removed.tracking.entities.entities.some((e) => e.entityId === id)).toBe(false);
    expect(removed.tracking.timeline.states.some((s) => s.dimension.includes(id))).toBe(false);
  });
  it("refuses, with the page count, someone a check has found", () => {
    const { data, tracking } = added();
    const found: FoundEntity = { ...OFFICE, canonId: data.entityId, pages: 3 };
    expect(removeEntity(tracking, ctx([found]), data.entityId)).toMatchObject({ code: "ENTITY_IN_USE", data: { pages: 3 }, error: "Odile appears in the manuscript — Bunsho read them on 3 pages" });
  });
  it("a promoted fact counts as in use", () => {
    const { data, tracking } = added();
    const t = ok(pinFound(tracking, ctx(), { entity: { canonId: data.entityId }, fact: { kind: "state", dimension: "voice", value: "low", stability: "stable", from: page } })).tracking;
    expect(declaredPagesFor(t, data.entityId)).toBe(1);
    expect(removeEntity(t, ctx(), data.entityId)).toMatchObject({ code: "ENTITY_IN_USE", data: { pages: 1 }, error: "Odile appears in the manuscript — Bunsho read them on 1 page" });
  });
  it("refuses an id we did not mint, and someone already gone", () => {
    const t = base();
    const foreign: CanonTracking = { ...t, entities: { ...t.entities, entities: [{ ...t.entities.entities[0], entityId: "ent_read" }] } };
    expect(removeEntity(foreign, ctx(), "ent_read")).toMatchObject({ code: "ENTITY_IN_USE", error: "Selma Corver was read from the manuscript, not added by hand" });
    expect(removeEntity(t, ctx(), "nobody")).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("identity", () => {
  it("first in file order wins, and the named entity itself is excluded", () => {
    expect(findIdentityMatch(base(), ctx(), "selma corver")?.canonicalName).toBe("Selma Corver");
    expect(findIdentityMatch(base(), ctx(), "selma corver", SELMA)).toBeNull();
  });
  it("a record entity answers for the found names it is linked to", () => {
    const linked: FoundEntity = { ...OFFICE, canonId: SELMA };
    expect(findIdentityMatch(base(), ctx([linked]), "the office")).toMatchObject({ ref: { canonId: SELMA } });
  });
});

describe("a saved record", () => {
  it("reads back as it was written", () => { expect(parseTracking(JSON.parse(JSON.stringify(base())))).toEqual({ tracking: base(), dropped: 0 }); });
  it("keeps what is well formed and says how much it could not", () => {
    const raw = JSON.parse(JSON.stringify(base())) as { entities: { entities: unknown[] }; timeline: { states: unknown[] }; knowledge: { facts: unknown[] } };
    raw.entities.entities.push({ entityId: 3 });
    raw.timeline.states.push({ stateId: "x", entityId: "nobody-here", dimension: "voice", value: "x", stability: "stable", openedAt: { origin: "writer", declaredAt: "d" } }, null);
    raw.knowledge.facts.push({ knowledgeId: "k" });
    expect(parseTracking(raw)).toEqual({ tracking: base(), dropped: 4 });
  });
  it("is no record at all when the shape is wrong", () => {
    for (const bad of [null, 3, {}, { entities: {}, timeline: {}, knowledge: {} }]) expect(parseTracking(bad)).toBeNull();
  });
});
