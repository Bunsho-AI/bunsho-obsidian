import { describe, expect, it } from "vitest";
import type { EngineTracking } from "@/helpers/director/world";
import type { CastMember, ChapterRead, Fact } from "@/lib/contract/pipelineV3.types";
import { projectPipelineV3World } from "@/helpers/director/world";

const empty = (): EngineTracking => ({
  entities: { version: 1, entities: [] }, timeline: { version: 1, anchors: [], states: [], elapsed: [] },
  knowledge: { version: 1, facts: [] }, pov: { version: 1, pages: {} },
});
let n = 0;
const fact = (pageId: string, over: Partial<Fact>): Fact => ({
  id: `${pageId}#${n++}`, pageId, order: 0, span: { start: n, end: n + 5 }, quote: `quote ${n}`, paragraph: 0, subject: "Mara", attribute: "eye colour",
  kind: "trait", statement: "s", question: "q", framing: "narration", speaker: null, textMarksUntrue: false, ...over,
});
const read = (pageId: string, order: number, facts: Fact[], names: string[] = ["Mara"]): ChapterRead => ({
  pageId, order, rev: `rev-${pageId}`, droppedFacts: 0, povBreaks: [], narration: { person: "third", povCharacter: "", tense: "past" },
  facts: facts.map((f) => ({ ...f, pageId, order })),
  cast: names.map((name) => ({ pageId, order, name, kind: name === "Pellin Light" ? "building" : "person", names: [{ name, proper: true }], role: "", introducedAliases: [] })),
});
const member = (name: string, over: Partial<CastMember> = {}): CastMember => ({
  id: name, name, kind: "person", names: [name], properNames: [name], aliases: [], chapters: [], roles: [], introduced: [], ...over,
});
const CAST = [member("Mara", { names: ["Mara", "Mara Vell", "the diver"], properNames: ["Mara", "Mara Vell"] }), member("Joe"), member("Pellin Light", { kind: "building" })];
const orders = (...ids: string[]) => new Map(ids.map((id, i) => [id, i]));

describe("projectPipelineV3World", () => {
  it("makes the cast the entities and the reads' facts found states and knowledge, filed under the World's keys", () => {
    const reads = [
      read("p1", 0, [fact("p1", { dimension: "appearance:eye_color", value: "grey" }),
        fact("p1", { dimension: "relationship", value: "sister", counterpart: "Joe", attribute: "relationship", kind: "relationship" }),
        fact("p1", { dimension: "knows", value: "the deed is forged", attribute: "the deed", kind: "knowledge" })], ["Mara", "Joe"]),
      read("p2", 1, [fact("p2", { dimension: "location", value: "Pellin Light", attribute: "whereabouts", kind: "location_travel" })], ["Mara", "Pellin Light"]),
    ];
    const out = projectPipelineV3World({ tracking: empty(), cast: CAST, reads, pageOrder: orders("p1", "p2") });
    const mara = out.entities.entities.find((e) => e.canonicalName === "Mara")!;
    const joe = out.entities.entities.find((e) => e.canonicalName === "Joe")!;
    expect(mara).toMatchObject({ type: "character", status: "active" });
    expect(mara.entityId).toMatch(/^ent_[a-z0-9_]+$/u);
    expect(mara.aliases).toEqual(expect.arrayContaining([{ text: "Mara Vell", kind: "full_name", grep: true }, { text: "the diver", kind: "epithet", grep: false }]));
    expect(mara.provenance.map((s) => ("pageId" in s ? s.pageId : ""))).toEqual(["p1", "p2"]);
    expect(out.entities.entities.find((e) => e.canonicalName === "Pellin Light")!.type).toBe("location");
    const states = out.timeline.states.map((s) => [s.entityId === mara.entityId ? "Mara" : s.entityId, s.dimension, s.value, s.stability]);
    expect(states).toEqual(expect.arrayContaining([["Mara", "appearance:eye_color", "grey", "stable"], ["Mara", `relationship:${joe.entityId}`, "sister", "stable"],
      ["Mara", "location", "Pellin Light", "dynamic"]]));
    expect(out.knowledge.facts).toEqual([expect.objectContaining({ entityId: mara.entityId, proposition: "the deed is forged",
      propositionKey: "the_deed_is_forged", polarity: "knows", learnedAt: expect.objectContaining({ pageId: "p1", rev: "rev-p1" }) })]);
    for (const state of out.timeline.states) expect(state.stateId).toMatch(/^st_[a-z0-9_]+$/u);
  });

  it("never touches the writer's records, and adds nothing where the writer pinned that entity and dimension", () => {
    const tracking = empty();
    tracking.entities.entities.push({ entityId: "ent_mara_hand", canonicalName: "Mara", type: "character", aliases: [], status: "active",
      provenance: [{ origin: "writer", declaredAt: "d" }] });
    const pin = { stateId: "st_pin", entityId: "ent_mara_hand", dimension: "appearance:eye_color", value: "green", stability: "stable" as const,
      openedAt: { origin: "writer" as const, declaredAt: "d" }, closedAt: null };
    const known = { knowledgeId: "kn_w", entityId: "ent_mara_hand", proposition: "the deed is forged", propositionKey: "the_deed_is_forged", polarity: "unaware",
      learnedAt: { origin: "writer" as const, declaredAt: "d" } };
    tracking.timeline.states.push(pin);
    tracking.knowledge.facts.push(known);
    const out = projectPipelineV3World({ tracking, cast: CAST, pageOrder: orders("p1"),
      reads: [read("p1", 0, [fact("p1", { dimension: "appearance:eye_color", value: "grey" }), fact("p1", { dimension: "knows", value: "the deed is forged" })])] });
    // The cast's Mara joins the writer's entity (same name), so the pin keeps naming her; the entity itself gains
    // nothing (no alias, no page stamp).
    expect(out.entities.entities.filter((e) => e.canonicalName === "Mara").map((e) => e.entityId)).toEqual(["ent_mara_hand"]);
    expect(out.entities.entities.find((e) => e.entityId === "ent_mara_hand")).toEqual(tracking.entities.entities[0]);
    expect(out.timeline.states).toEqual([pin]);
    expect(out.knowledge.facts).toEqual([known]);
  });

  it("is stable: a second rebuild changes nothing, so a pin made from a found fact keeps its ids", () => {
    const reads = [read("p1", 0, [fact("p1", { dimension: "appearance:eye_color", value: "grey" })])];
    const once = projectPipelineV3World({ tracking: empty(), cast: CAST, reads, pageOrder: orders("p1") });
    const twice = projectPipelineV3World({ tracking: once, cast: CAST, reads, pageOrder: orders("p1") });
    expect(twice).toEqual(once);
  });

  it("rebuilds only pages that have a v3 read: another page's found records stay", () => {
    const tracking = empty();
    const old = { stateId: "st_v2_old", entityId: "ent_joe_v2", dimension: "location", value: "the forge", stability: "dynamic" as const,
      openedAt: { pageId: "p9", pageOrder: 9, rev: "r9", quote: "Joe stood at the forge." }, closedAt: null };
    tracking.entities.entities.push({ entityId: "ent_joe_v2", canonicalName: "Joe", type: "character", aliases: [], status: "active",
      provenance: [{ pageId: "p9", pageOrder: 9, rev: "r9", quote: "Joe" }] });
    tracking.timeline.states.push(old, { ...old, stateId: "st_v2_gone", openedAt: { pageId: "p1", pageOrder: 0, rev: "r0", quote: "Joe left." } });
    const out = projectPipelineV3World({ tracking, cast: CAST, pageOrder: new Map([["p1", 0], ["p9", 9]]), reads: [read("p1", 0, [], ["Joe"])] });
    expect(out.timeline.states.map((s) => s.stateId)).toEqual(["st_v2_old"]);
    // The cast's Joe joins the existing entity, which keeps p9 and gains p1.
    expect(out.entities.entities.find((e) => e.entityId === "ent_joe_v2")!.provenance.map((s) => ("pageId" in s ? s.pageId : ""))).toEqual(["p9", "p1"]);
  });

  it("closes a changing state where the next opens, and keeps a lasting one's first value", () => {
    const reads = [
      read("p1", 0, [fact("p1", { dimension: "location", value: "the quay", kind: "location_travel" }), fact("p1", { dimension: "appearance:eye_color", value: "grey" })]),
      read("p2", 1, [fact("p2", { dimension: "location", value: "the quay", kind: "location_travel" })]),
      read("p3", 2, [fact("p3", { dimension: "location", value: "Pellin Light", kind: "location_travel" }), fact("p3", { dimension: "appearance:eye_color", value: "brown" })]),
    ];
    const out = projectPipelineV3World({ tracking: empty(), cast: CAST, reads, pageOrder: orders("p1", "p2", "p3") });
    const location = out.timeline.states.filter((s) => s.dimension === "location");
    expect(location.map((s) => [s.value, s.closedAt && "pageId" in s.closedAt ? s.closedAt.pageId : null])).toEqual([["the quay", "p3"], ["Pellin Light", null]]);
    expect(out.timeline.states.filter((s) => s.dimension === "appearance:eye_color").map((s) => s.value)).toEqual(["grey"]);
  });

  it("holds only what the story itself says as fact: no dialogue, nothing the text marks untrue, no plan, estimate, rhetoric, rumour or corrected claim, no value, no unknown counterpart, no event", () => {
    const reads = [read("p1", 0, [
      fact("p1", { dimension: "appearance:eye_color", value: "blue", framing: "dialogue" }),
      fact("p1", { dimension: "location", value: "Paris", status: "plan" }),
      fact("p1", { dimension: "appearance:age", value: "about forty", status: "estimate" }),
      fact("p1", { dimension: "appearance:hair", value: "green", status: "rhetoric" }),
      fact("p1", { dimension: "appearance:build", value: "stout", status: "rumour" }),
      fact("p1", { dimension: "appearance:eye_color", value: "grey", status: "corrected" }),
      fact("p1", { dimension: "appearance:height", value: "tall", textMarksUntrue: true }),
      fact("p1", { dimension: "appearance:build", value: "  " }),
      fact("p1", { dimension: "relationship", value: "cousin", counterpart: "Somebody Else", kind: "relationship" }),
      fact("p1", { subject: "A stranger", dimension: "appearance:age", value: "forty" }),
      fact("p1", { dimension: "none", attribute: "visit", value: "came at six", kind: "clock_time" }),
    ])];
    expect(projectPipelineV3World({ tracking: empty(), cast: CAST, reads, pageOrder: orders("p1") }).timeline.states).toEqual([]);
  });

  it("files no relationship with oneself and no person as a possession", () => {
    const reads = [read("p1", 0, [
      fact("p1", { dimension: "relationship", value: "guardian", counterpart: "Mara", attribute: "relationship", kind: "relationship" }),
      fact("p1", { dimension: "possession", value: "daily dinner", counterpart: "Joe", attribute: "possession", kind: "object_state" }),
      fact("p1", { dimension: "possession", value: "keeps it lit", counterpart: "Pellin Light", attribute: "possession", kind: "object_state" }),
    ], ["Mara", "Joe", "Pellin Light"])];
    const out = projectPipelineV3World({ tracking: empty(), cast: CAST, reads, pageOrder: orders("p1") });
    const light = out.entities.entities.find((e) => e.canonicalName === "Pellin Light")!;
    expect(out.timeline.states.map((s) => [s.dimension, s.value])).toEqual([[`possession:${light.entityId}`, "keeps it lit"]]);
  });

  it("keeps an `other` property only when it lasts: no clock times, counts, movements or names", () => {
    const reads = [read("p1", 0, [
      fact("p1", { dimension: "other", attribute: "occupation", value: "harbour pilot", kind: "trait" }),
      fact("p1", { dimension: "other", attribute: "predicted slack-water time", value: "twelve minutes past six", kind: "clock_time" }),
      fact("p1", { dimension: "other", attribute: "alias", value: "Redlow", kind: "name_alias" }),
      fact("p1", { dimension: "other", attribute: "survey", value: "three weeks", kind: "count_number" }),
    ])];
    const out = projectPipelineV3World({ tracking: empty(), cast: CAST, reads, pageOrder: orders("p1") });
    expect(out.timeline.states.map((s) => [s.dimension, s.value])).toEqual([["occupation", "harbour pilot"]]);
  });

  it("never joins individuals the cast kept apart: shared first names, shared descriptions, chains, one surname", () => {
    const cast = [
      member("John Smith", { names: ["John Smith", "John", "the old man"], properNames: ["John Smith", "John"] }),
      member("John Doe", { names: ["John Doe", "John", "the old man"], properNames: ["John Doe", "John"] }),
      member("Arlo", { names: ["Arlo", "the boy"] }), member("Bram", { names: ["Bram", "the boy", "the stranger"] }), member("Cato", { names: ["Cato", "the stranger"] }),
      member("山田太郎", { names: ["山田太郎", "山田"], properNames: ["山田太郎", "山田"] }), member("山田花子", { names: ["山田花子", "山田"], properNames: ["山田花子", "山田"] }),
    ];
    const eyes = (subject: string, value: string) => fact("p1", { subject, dimension: "appearance:eye_color", value });
    const reads = [read("p1", 0, [eyes("John Smith", "brown"), eyes("John Doe", "blue"), eyes("John", "green"), eyes("山田太郎", "黒"), eyes("山田花子", "茶")],
      cast.map((m) => m.name))];
    const once = projectPipelineV3World({ tracking: empty(), cast, reads, pageOrder: orders("p1") });
    expect(once.entities.entities.map((e) => e.canonicalName).sort()).toEqual(["Arlo", "Bram", "Cato", "John Doe", "John Smith", "山田太郎", "山田花子"].sort());
    const eyesOf = (t: EngineTracking, name: string) => t.timeline.states.filter((s) => s.entityId === t.entities.entities.find((e) => e.canonicalName === name)!.entityId).map((s) => s.value);
    expect([eyesOf(once, "John Smith"), eyesOf(once, "John Doe"), eyesOf(once, "山田太郎"), eyesOf(once, "山田花子")]).toEqual([["brown"], ["blue"], ["黒"], ["茶"]]);
    // "John" alone could be either: it is filed under nobody rather than guessed.
    expect(once.timeline.states.map((s) => s.value)).not.toContain("green");
    // And a second rebuild finds every one of them again under the same id.
    const twice = projectPipelineV3World({ tracking: once, cast, reads, pageOrder: orders("p1") });
    expect(twice.entities.entities.map((e) => e.entityId).sort()).toEqual(once.entities.entities.map((e) => e.entityId).sort());
    expect(twice).toEqual(once);
  });

  it("gives two individuals the same passage names their own records, so each can be pinned", () => {
    const quote = "Mara and Joe stood together on the quay; Mara knew the deed was forged and that Joe had signed it.";
    const reads = [read("p1", 0, [
      fact("p1", { quote, subject: "Mara", dimension: "location", value: "the quay", kind: "location_travel" }),
      fact("p1", { quote, subject: "Joe", dimension: "location", value: "the quay", kind: "location_travel" }),
      fact("p1", { quote, subject: "Mara", dimension: "knows", value: "the deed is forged", kind: "knowledge" }),
      fact("p1", { quote, subject: "Mara", dimension: "knows", value: "Joe signed the deed", kind: "knowledge" }),
    ], ["Mara", "Joe"])];
    const out = projectPipelineV3World({ tracking: empty(), cast: CAST, reads, pageOrder: orders("p1") });
    expect(new Set(out.timeline.states.map((s) => s.stateId)).size).toBe(2);
    expect(new Set(out.knowledge.facts.map((k) => k.knowledgeId)).size).toBe(2);
  });

  it("files a name the book gives both a place and a person under the one the chapter means", () => {
    const cast = [member("Pellin", { id: "pellin-light", kind: "building", chapters: [0] }), member("Pellin", { id: "pellin-man", kind: "person", chapters: [0] })];
    const out = projectPipelineV3World({ tracking: empty(), cast, pageOrder: orders("p1"),
      reads: [read("p1", 0, [fact("p1", { subject: "Pellin", dimension: "appearance:eye_color", value: "grey" })], ["Pellin"])] });
    // The chapter's own record calls Pellin a person: the fact is the man's, and he is in the World. (The lighthouse,
    // which no chapter read here names, is not.)
    const person = out.entities.entities.find((e) => e.type === "character" && e.canonicalName === "Pellin")!;
    expect(person.provenance).toHaveLength(1);
    expect(out.timeline.states.map((s) => [s.entityId, s.value])).toEqual([[person.entityId, "grey"]]);
  });

  it("keeps an entity a writer's pin names as the other party, and organizations v3 never names", () => {
    const tracking = empty();
    const found = (entityId: string, canonicalName: string, type: string) => ({ entityId, canonicalName, type, aliases: [], status: "active" as const,
      provenance: [{ pageId: "p1", pageOrder: 0, rev: "r0", quote: canonicalName }] });
    tracking.entities.entities.push(found("ent_beacon", "the Beacon", "object"), found("ent_guild", "the Guild", "organization"));
    tracking.timeline.states.push({ stateId: "st_pin", entityId: "ent_mara_hand", dimension: "possession:ent_beacon", value: "keeps it lit", stability: "stable",
      openedAt: { origin: "writer", declaredAt: "d" }, closedAt: null });
    const out = projectPipelineV3World({ tracking, cast: CAST, pageOrder: orders("p1"), reads: [read("p1", 0, [])] });
    expect(out.entities.entities.map((e) => e.entityId)).toEqual(expect.arrayContaining(["ent_beacon", "ent_guild"]));
  });

  it("drops a deleted chapter's found records, and caps an entity's page stamps at the engine's limit", () => {
    const tracking = empty();
    tracking.entities.entities.push({ entityId: "ent_v2_mara", canonicalName: "Mara", type: "character", aliases: [], status: "active",
      provenance: Array.from({ length: 505 }, (_, i) => ({ pageId: `q${i}`, pageOrder: i + 1, rev: "r", quote: "Mara" })) });
    tracking.timeline.states.push({ stateId: "st_gone", entityId: "ent_v2_mara", dimension: "location", value: "the reef", stability: "dynamic",
      openedAt: { pageId: "p_deleted", pageOrder: 3, rev: "r", quote: "Mara swam to the reef." }, closedAt: null });
    const pageOrder = new Map([["p1", 0], ...Array.from({ length: 505 }, (_, i) => [`q${i}`, i + 1] as [string, number])]);
    const out = projectPipelineV3World({ tracking, cast: CAST, pageOrder, reads: [read("p1", 0, [])] });
    expect(out.timeline.states).toEqual([]);
    expect(out.entities.entities.find((e) => e.entityId === "ent_v2_mara")!.provenance).toHaveLength(500);
  });

  it("closes an earlier reading's open state where a v3 one follows, and reopens one whose closing was rebuilt away", () => {
    const tracking = empty();
    tracking.entities.entities.push({ entityId: "ent_v2_mara", canonicalName: "Mara", type: "character", aliases: [], status: "active",
      provenance: [{ pageId: "p0", pageOrder: 0, rev: "r", quote: "Mara" }] });
    const at = (pageId: string, pageOrder: number, quote: string) => ({ pageId, pageOrder, rev: "r", quote });
    tracking.timeline.states.push(
      // v2, on a page v3 has not read: open at the forge.
      { stateId: "st_v2_forge", entityId: "ent_v2_mara", dimension: "location", value: "the forge", stability: "dynamic", openedAt: at("p0", 0, "at the forge"), closedAt: null },
      // v2, closed by a v2 state on p2, which v3 now rebuilds (and finds nothing there).
      { stateId: "st_v2_ship", entityId: "ent_v2_mara", dimension: "injury", value: "a cut hand", stability: "dynamic", openedAt: at("p0", 0, "cut her hand"), closedAt: at("p2", 2, "healed") },
    );
    const reads = [read("p1", 1, [fact("p1", { dimension: "location", value: "the quay", kind: "location_travel" })]), read("p2", 2, [])];
    const out = projectPipelineV3World({ tracking, cast: CAST, reads, pageOrder: new Map([["p0", 0], ["p1", 1], ["p2", 2]]) });
    const forge = out.timeline.states.find((s) => s.stateId === "st_v2_forge")!;
    expect(forge.closedAt).toMatchObject({ pageId: "p1" });
    expect(out.timeline.states.filter((s) => s.dimension === "location" && !s.closedAt).map((s) => s.value)).toEqual(["the quay"]);
    expect(out.timeline.states.find((s) => s.stateId === "st_v2_ship")!.closedAt).toBeNull();
  });

  it("keeps two namesakes' ids when the writer pins one of them, and when a third namesake appears earlier", () => {
    const smith = member("Joe", { id: "joe-smith", names: ["Joe", "the smith"], chapters: [0] });
    const ferryman = member("Joe", { id: "joe-ferry", names: ["Joe", "the ferryman"], chapters: [1] });
    const eyes = (pageId: string, value: string) => fact(pageId, { subject: "Joe", dimension: "appearance:eye_color", value });
    const reads = [read("p1", 0, [eyes("p1", "grey")], ["Joe"]), read("p2", 1, [eyes("p2", "blue")], ["Joe"])];
    const once = projectPipelineV3World({ tracking: empty(), cast: [smith, ferryman], reads, pageOrder: orders("p1", "p2") });
    const idOf = (t: EngineTracking, value: string) => t.timeline.states.find((st) => st.value === value)!.entityId;
    expect(idOf(once, "grey")).not.toBe(idOf(once, "blue"));
    // The writer pins the smith's grey eyes (the pen stamps his entity as the writer's).
    const pinned = structuredClone(once);
    const grey = pinned.timeline.states.find((st) => st.value === "grey")!;
    grey.openedAt = { origin: "writer", declaredAt: "d", from: grey.openedAt as never };
    pinned.entities.entities.find((e) => e.entityId === grey.entityId)!.provenance.push({ origin: "writer", declaredAt: "d" });
    const twice = projectPipelineV3World({ tracking: pinned, cast: [smith, ferryman], reads, pageOrder: orders("p1", "p2") });
    expect(twice.entities.entities.filter((e) => e.canonicalName === "Joe")).toHaveLength(2);
    expect(idOf(twice, "blue")).toBe(idOf(once, "blue"));
    expect(twice.timeline.states.find((st) => st.value === "grey")).toEqual(grey);
    // A third Joe who appears first (a new prologue) moves nobody's id.
    const prologue = member("Joe", { id: "joe-old", names: ["Joe", "old Joe"], chapters: [0] });
    const shifted = [read("p0", 0, [], ["Joe"]), read("p1", 1, [eyes("p1", "grey")], ["Joe"]), read("p2", 2, [eyes("p2", "blue")], ["Joe"])];
    const moved = projectPipelineV3World({ tracking: once, cast: [prologue, { ...smith, chapters: [1] }, { ...ferryman, chapters: [2] }], reads: shifted, pageOrder: orders("p0", "p1", "p2") });
    expect(idOf(moved, "grey")).toBe(idOf(once, "grey"));
    expect(idOf(moved, "blue")).toBe(idOf(once, "blue"));
  });

  it("rebuilds a found entity's aliases from the cast, so a name an earlier merge added does not stay", () => {
    const once = projectPipelineV3World({ tracking: empty(), cast: [member("Joe", { names: ["Joe", "the smith", "the ferryman"] })], reads: [read("p1", 0, [], ["Joe"])], pageOrder: orders("p1") });
    const split = projectPipelineV3World({ tracking: once, cast: [member("Joe", { names: ["Joe", "the smith"] })], reads: [read("p1", 0, [], ["Joe"])], pageOrder: orders("p1") });
    expect(split.entities.entities[0].aliases.map((a) => a.text)).toEqual(["the smith"]);
  });

  it("files a person's fact on the person when a chapter also has a place of that name, and guesses nothing else", () => {
    const cast = [member("Pellin", { id: "light", kind: "building", chapters: [0] }), member("Pellin", { id: "man", kind: "person", chapters: [0] })];
    const both = read("p1", 0, [
      fact("p1", { subject: "Pellin", dimension: "appearance:eye_color", value: "grey" }),
      fact("p1", { subject: "Pellin", dimension: "location", value: "the headland", kind: "location_travel" }),
    ], ["Pellin"]);
    both.cast.push({ ...both.cast[0], kind: "building" });
    const out = projectPipelineV3World({ tracking: empty(), cast, reads: [both], pageOrder: orders("p1") });
    const man = out.entities.entities.find((e) => e.type === "character")!;
    // Eyes are a person's; where "Pellin" stands could be either, so it is filed under nobody.
    expect(out.timeline.states.map((st) => [st.entityId, st.value])).toEqual([[man.entityId, "grey"]]);
  });

  it("keeps an earlier reading's open lasting value alone, and reopens one whose closing was rebuilt away", () => {
    const tracking = empty();
    tracking.entities.entities.push({ entityId: "ent_v2_mara", canonicalName: "Mara", type: "character", aliases: [], status: "active",
      provenance: [{ pageId: "p0", pageOrder: 0, rev: "r", quote: "Mara" }] });
    const at = (pageId: string, pageOrder: number) => ({ pageId, pageOrder, rev: "r", quote: "q" });
    tracking.timeline.states.push(
      { stateId: "st_v2_eyes", entityId: "ent_v2_mara", dimension: "appearance:eye_color", value: "blue", stability: "stable", openedAt: at("p0", 0), closedAt: null },
      { stateId: "st_v2_trait", entityId: "ent_v2_mara", dimension: "trait", value: "stubborn", stability: "stable", openedAt: at("p0", 0), closedAt: at("p1", 1) },
    );
    const reads = [read("p1", 1, [fact("p1", { dimension: "appearance:eye_color", value: "grey" })])];
    const out = projectPipelineV3World({ tracking, cast: CAST, reads, pageOrder: new Map([["p0", 0], ["p1", 1]]) });
    expect(out.timeline.states.filter((st) => st.dimension === "appearance:eye_color").map((st) => st.value)).toEqual(["blue"]);
    expect(out.timeline.states.find((st) => st.stateId === "st_v2_trait")!.closedAt).toBeNull();
  });

  it("drops a found entity nothing names any more, but never one a writer record names", () => {
    const tracking = empty();
    tracking.entities.entities.push(
      { entityId: "ent_stale", canonicalName: "Tomas", type: "character", aliases: [], status: "active", provenance: [{ pageId: "p1", pageOrder: 0, rev: "r0", quote: "Tomas" }] },
      { entityId: "ent_pinned", canonicalName: "Anton", type: "character", aliases: [], status: "active", provenance: [{ pageId: "p1", pageOrder: 0, rev: "r0", quote: "Anton" }] });
    tracking.timeline.states.push({ stateId: "st_pin", entityId: "ent_pinned", dimension: "trait", value: "stubborn", stability: "stable",
      openedAt: { origin: "writer", declaredAt: "d" }, closedAt: null });
    const out = projectPipelineV3World({ tracking, cast: CAST, pageOrder: orders("p1"), reads: [read("p1", 0, [])] });
    expect(out.entities.entities.map((e) => e.entityId)).toContain("ent_pinned");
    expect(out.entities.entities.map((e) => e.entityId)).not.toContain("ent_stale");
  });
});
