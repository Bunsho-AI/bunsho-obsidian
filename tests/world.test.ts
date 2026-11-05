import { describe, expect, it } from "vitest";
import { filterChanges, filterWorld, projectWorld, worldChanges } from "@/helpers/world";
import type { CastMember, ChapterRead, Fact } from "@/lib/contract/pipelineV3.types";

const member = (id: string, name: string, chapters: number[], extra: Partial<CastMember> = {}): CastMember => ({
  id, name, kind: "person", names: [name], properNames: [name], aliases: [], chapters, roles: [], introduced: [], ...extra,
});
const fact = (order: number, subject: string, value: string, dimension: Fact["dimension"], extra: Partial<Fact> = {}): Fact => ({
  id: `${order}#${value}`, pageId: `p${order}`, order, span: { start: order, end: order + 5 }, quote: `quote ${value}`, paragraph: 0, subject, attribute: "attr", value, dimension,
  counterpart: null, status: "fact", kind: "trait", statement: "", question: "", framing: "narration", speaker: null, textMarksUntrue: false, ...extra,
});
const read = (order: number, facts: Fact[], cast: ChapterRead["cast"] = []): ChapterRead => ({
  pageId: `p${order}`, order, rev: "r", facts, cast, narration: { person: "third", povCharacter: "", tense: "past" }, povBreaks: [], droppedFacts: 0,
});
const rowsOf = (entity: { rows: { label: string; value: string }[] } | undefined) => entity?.rows.map((r) => `${r.label}: ${r.value}`);

describe("projectWorld", () => {
  it("turns the cast into entities with their facts and the passage each came from", () => {
    const [mira] = projectWorld([member("m", "Mira", [0])], [read(0, [fact(0, "Mira", "green", "appearance:eye_color")])]);
    expect(mira).toMatchObject({ name: "Mira", type: "character", scenes: 1, tier: "mentioned" });
    expect(mira.rows[0]).toMatchObject({ label: "Eye colour", value: "green", quote: "quote green", pageId: "p0", start: 0, end: 5, earlier: false });
  });

  it("keeps the first value of what lasts: a later different one is a finding, not the world", () => {
    const [mira] = projectWorld([member("m", "Mira", [0, 1])], [read(0, [fact(0, "Mira", "green", "appearance:eye_color")]), read(1, [fact(1, "Mira", "brown", "appearance:eye_color")])]);
    expect(rowsOf(mira)).toEqual(["Eye colour: green"]);
  });

  it("reads a page's facts in passage order, as a read merges two passes out of order", () => {
    const later = fact(0, "Mira", "the garden", "location", { span: { start: 900, end: 910 } });
    const sooner = fact(0, "Mira", "the cellar", "location", { span: { start: 100, end: 110 } });
    const [mira] = projectWorld([member("m", "Mira", [0])], [read(0, [later, sooner])]);
    expect(mira.rows.map((r) => [r.value, r.earlier])).toEqual([["the cellar", true], ["the garden", false]]);
    const eyes = [fact(0, "Mira", "brown", "appearance:eye_color", { span: { start: 900, end: 910 } }), fact(0, "Mira", "green", "appearance:eye_color", { span: { start: 100, end: 110 } })];
    expect(rowsOf(projectWorld([member("m", "Mira", [0])], [read(0, eyes)])[0])).toEqual(["Eye colour: green"]);
  });

  it("treats an unfiled attribute named like a changing state as changing, as the desktop does", () => {
    const facts = [fact(0, "Mira", "a limp", "other", { attribute: "injury" }), fact(1, "Mira", "healed", "other", { attribute: "injury", order: 1 })];
    expect(projectWorld([member("m", "Mira", [0, 1])], [read(0, [facts[0]]), read(1, [facts[1]])])[0].rows).toHaveLength(2);
  });

  it("shows and searches every name the book gives them", () => {
    const entities = projectWorld([member("m", "Mira", [0], { names: ["Mira", "the old captain"] })], []);
    expect(entities[0].aliases).toEqual(["the old captain"]);
    expect(filterWorld(entities, "people", "captain")).toHaveLength(1);
  });

  it("records each change of what changes, and marks the earlier ones", () => {
    const reads = [read(0, [fact(0, "Mira", "the harbour", "location")]), read(1, [fact(1, "Mira", "The Harbour", "location")]), read(2, [fact(2, "Mira", "the inn", "location")])];
    const [mira] = projectWorld([member("m", "Mira", [0, 1, 2])], [reads[2], reads[0], reads[1]]);
    expect(mira.rows.map((r) => [r.value, r.earlier])).toEqual([["the harbour", true], ["the inn", false]]);
  });

  it("leaves out what the story does not state as fact", () => {
    const cast = [member("m", "Mira", [0])];
    for (const extra of [{ framing: "dialogue" as const }, { textMarksUntrue: true }, { status: "rumour" as const }, { status: "corrected" as const }]) {
      expect(projectWorld(cast, [read(0, [fact(0, "Mira", "green", "appearance:eye_color", extra)])])[0].rows).toEqual([]);
    }
    expect(projectWorld(cast, [read(0, [fact(0, "Mira", "x", "none"), fact(0, "Mira", "  ", "trait")])])[0].rows).toEqual([]);
    expect(projectWorld(cast, [read(0, [fact(0, "Mira", "9pm", "other", { kind: "clock_time" })])])[0].rows).toEqual([]);
  });

  it("files a relationship under the other person, and skips one it cannot name", () => {
    const cast = [member("m", "Mira", [0]), member("t", "Tobias", [0])];
    const [mira] = projectWorld(cast, [read(0, [fact(0, "Mira", "sister", "relationship", { counterpart: "Tobias" }), fact(0, "Mira", "friend", "relationship", { counterpart: "Nobody" })])]);
    expect(rowsOf(mira)).toEqual(["Relationship with Tobias: sister"]);
  });

  it("does not give a person as a possession", () => {
    const cast = [member("m", "Mira", [0]), member("t", "Tobias", [0]), member("k", "The key", [0], { kind: "object" })];
    const entities = projectWorld(cast, [read(0, [fact(0, "Mira", "holds", "possession", { counterpart: "Tobias" }), fact(0, "Mira", "holds", "possession", { counterpart: "The key" })])]);
    expect(rowsOf(entities.find((e) => e.id === "m"))).toEqual(["Possession of The key: holds"]);
  });

  it("keeps each piece of knowledge, labelled by what they know", () => {
    const [mira] = projectWorld([member("m", "Mira", [0])], [read(0, [fact(0, "Mira", "the bell rang", "knows"), fact(0, "Mira", "the letter is forged", "suspects")])]);
    expect(rowsOf(mira)).toEqual(["Knows: the bell rang", "Suspects: the letter is forged"]);
  });

  it("never guesses between two people who share a name", () => {
    const cast = [member("a", "Georgiana", [0], { properNames: ["Georgiana"] }), member("b", "Georgiana", [0], { properNames: ["Georgiana"] })];
    const entities = projectWorld(cast, [read(0, [fact(0, "Georgiana", "kind", "trait")])]);
    expect(entities).toHaveLength(2);
    expect(entities.every((e) => e.rows.length === 0)).toBe(true);
  });

  it("tells a shared name apart by the page it appears on", () => {
    const cast = [member("a", "Georgiana", [0]), member("b", "Georgiana", [5])];
    const entities = projectWorld(cast, [read(5, [fact(5, "Georgiana", "kind", "trait")])]);
    expect(rowsOf(entities.find((e) => e.id === "b"))).toEqual(["Personality trait: kind"]);
    expect(rowsOf(entities.find((e) => e.id === "a"))).toEqual([]);
  });

  it("holds in any language", () => {
    const [mira] = projectWorld([member("m", "ミラ", [0], { properNames: ["ミラ", "ミラ・ヴェイル"] })], [read(0, [fact(0, "ミラ", "緑", "appearance:eye_color"), fact(0, "ミラ・ヴェイル", "港", "location")])]);
    expect(mira.name).toBe("ミラ");
    expect(mira.aliases).toEqual(["ミラ・ヴェイル"]);
    expect(rowsOf(mira)).toEqual(["Eye colour: 緑", "Location: 港"]);
  });

  it("orders by how much of the book they are in, and groups as the desktop does", () => {
    const cast = [member("a", "Minor", [1]), member("b", "Lead", [0, 1, 2, 3, 4]), member("c", "Side", [0, 2])];
    expect(projectWorld(cast, []).map((e) => [e.name, e.tier])).toEqual([["Lead", "main"], ["Side", "supporting"], ["Minor", "mentioned"]]);
  });

  it("maps cast kinds to people, places, things and groups, as the desktop's five filters", () => {
    const kinds = ["person", "place", "building", "vessel", "animal", "object", "group"] as const;
    const entities = projectWorld(kinds.map((kind) => member(kind, kind, [0], { kind })), []);
    const names = (filter: "people" | "places" | "things" | "groups") => filterWorld(entities, filter, "").map((e) => e.name).sort();
    expect(names("people")).toEqual(["person"]);
    expect(names("places")).toEqual(["building", "place"]);
    expect(names("things")).toEqual(["animal", "object", "vessel"]);
    expect(names("groups")).toEqual(["group"]);
  });
});

describe("groups the reads carry", () => {
  // A record names itself as proper or not, in `names`.
  const guild = (order: number, name = "the Harbour Guild", names: ChapterRead["cast"][number]["names"] = [{ name, proper: true }]): ChapterRead["cast"][number] =>
    ({ pageId: `p${order}`, order, name, kind: "group", names, role: "dock workers", introducedAliases: [] });
  const groups = (cast: CastMember[], reads: ChapterRead[]) => filterWorld(projectWorld(cast, reads), "groups", "");

  it("lists a group a chapter's reader saw, though the engine's cast leaves groups out", () => {
    const [group] = groups([member("m", "Mira", [0])], [read(0, [], [guild(0)]), read(2, [], [guild(2)])]);
    expect(group).toMatchObject({ name: "the Harbour Guild", type: "organization", scenes: 2, tier: "supporting", rows: [] });
  });

  it("shows nothing when no read carries a group, rather than inventing one", () => {
    expect(groups([member("m", "Mira", [0])], [read(0, [fact(0, "Mira", "green", "appearance:eye_color")])])).toEqual([]);
  });

  it("is one group across chapters by its name, however it is written", () => {
    const entities = groups([], [read(0, [], [guild(0, "The Harbour Guild")]), read(1, [], [guild(1, "the harbour guild")])]);
    expect(entities).toHaveLength(1);
    expect(entities[0].scenes).toBe(2);
  });

  it("never joins two groups because one's other name is the other's name: identity is not a string match", () => {
    const longName = guild(0, "the Harbour Guild", [{ name: "the Harbour Guild", proper: true }, { name: "the Guild", proper: false }]);
    expect(groups([], [read(0, [], [longName, guild(0, "the Guild")])]).map((e) => e.name).sort()).toEqual(["the Guild", "the Harbour Guild"]);
  });

  it("keeps the other names it was given, to show and to search", () => {
    const entities = groups([], [read(0, [], [guild(0, "the Harbour Guild", [{ name: "the Harbour Guild", proper: true }, { name: "the dockers", proper: false }])])]);
    expect(entities[0].aliases).toEqual(["the dockers"]);
    expect(filterWorld(entities, "groups", "dockers")).toHaveLength(1);
  });

  it("files a fact under the group it names", () => {
    const [group] = groups([], [read(0, [fact(0, "the Harbour Guild", "the old quay", "location")], [guild(0)])]);
    expect(rowsOf(group)).toEqual(["Location: the old quay"]);
  });

  it("leaves a name the cast already holds to the cast: what was theirs stays theirs", () => {
    const cast = [member("c", "The Carraways", [0], { kind: "person", names: ["The Carraways", "the family"] })];
    const reads = [read(0, [fact(0, "The Carraways", "kind", "trait"), fact(0, "the family", "the old quay", "location")],
      [guild(0, "The Carraways", [{ name: "The Carraways", proper: true }, { name: "the family", proper: false }, { name: "the clan", proper: false }])])];
    const entities = projectWorld(cast, reads);
    expect(entities.map((e) => [e.name, e.type])).toEqual([["The Carraways", "character"]]);
    expect(rowsOf(entities[0])).toEqual(["Personality trait: kind", "Location: the old quay"]);
  });

  it("does not take a name from the cast through a group's other name", () => {
    const cast = [member("m", "Mira", [0])];
    const reads = [read(0, [fact(0, "Mira", "kind", "trait")], [guild(0, "the Guild", [{ name: "the Guild", proper: true }, { name: "Mira", proper: false }])])];
    const entities = projectWorld(cast, reads);
    expect(rowsOf(entities.find((e) => e.id === "m"))).toEqual(["Personality trait: kind"]);
    expect(entities.find((e) => e.type === "organization")?.aliases).toEqual([]);
  });

  it("files no fact under a group with no proper name: the crew of two ships is not one crew", () => {
    const crew = (order: number) => guild(order, "the crew", [{ name: "the crew", proper: false }]);
    const entities = groups([], [read(0, [fact(0, "the crew", "the Dawn", "location")], [crew(0)]), read(1, [fact(1, "the crew", "the harbour", "location")], [crew(1)])]);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ name: "the crew", rows: [], changes: [] });
  });

  it("does not give a group as something a person holds, but keeps a tie to one", () => {
    const facts = [fact(0, "Mira", "holds", "possession", { counterpart: "the Harbour Guild" }), fact(0, "Mira", "member", "relationship", { counterpart: "the Harbour Guild" })];
    const mira = projectWorld([member("m", "Mira", [0])], [read(0, facts, [guild(0)])]).find((e) => e.id === "m");
    expect(rowsOf(mira)).toEqual(["Relationship with the Harbour Guild: member"]);
  });

  it("holds in any language", () => {
    const [group] = groups([], [read(0, [], [guild(0, "港湾組合")])]);
    expect(group.name).toBe("港湾組合");
  });
});

describe("worldChanges", () => {
  const changes = (reads: ChapterRead[], cast = [member("m", "Mira", [0, 1, 2])]) => worldChanges(projectWorld(cast, reads));
  const moved = (order: number, value: string, extra: Partial<Fact> = {}) => read(order, [fact(order, "Mira", value, "location", extra)]);

  it("gives each change of a changing state across chapters, with both passages", () => {
    const [change, ...rest] = changes([moved(0, "the harbour"), moved(1, "the inn")]);
    expect(rest).toEqual([]);
    expect(change).toMatchObject({ entityId: "m", entityName: "Mira", label: "Location" });
    expect(change.from).toMatchObject({ value: "the harbour", pageId: "p0", quote: "quote the harbour", start: 0, end: 5 });
    expect(change.to).toMatchObject({ value: "the inn", pageId: "p1", quote: "quote the inn", start: 1, end: 6 });
  });

  it("has none for what lasts: a later different value is a finding, not a change", () => {
    expect(changes([read(0, [fact(0, "Mira", "green", "appearance:eye_color")]), read(1, [fact(1, "Mira", "brown", "appearance:eye_color")])])).toEqual([]);
  });

  it("has none for the same value again, however it is written", () => {
    expect(changes([moved(0, "the harbour"), moved(1, "The Harbour")])).toEqual([]);
  });

  it("leaves out what one chapter says twice: a change is across chapters, and never reads as a contradiction", () => {
    const first = fact(0, "Mira", "the cellar", "location", { span: { start: 10, end: 20 } });
    const second = fact(0, "Mira", "the garden", "location", { span: { start: 50, end: 60 } });
    const list = changes([read(0, [first, second]), moved(1, "the inn")]);
    expect(list.map((c) => [c.from.value, c.to.value])).toEqual([["the garden", "the inn"]]);
  });

  it("leaves out what the parts of one long chapter say: a chapter is what the writer sees", () => {
    const reads = [moved(0, "the harbour"), moved(1, "the inn"), moved(2, "the quay")];
    const chapter = new Map([["p0", "long"], ["p1", "long"], ["p2", "next"]]);
    const list = worldChanges(projectWorld([member("m", "Mira", [0, 1, 2])], reads, { chapter }));
    expect(list.map((c) => [c.from.value, c.to.value])).toEqual([["the inn", "the quay"]]);
  });

  it("follows the story's current order when a chapter has moved, so a change never reads backwards", () => {
    const reads = [moved(0, "the harbour"), moved(1, "the inn")];
    const order = new Map([["p0", 1], ["p1", 0]]);
    const [change] = worldChanges(projectWorld([member("m", "Mira", [0, 1])], reads, { order }));
    expect([change.from.value, change.to.value, change.to.order]).toEqual(["the inn", "the harbour", 1]);
  });

  it("still tells a shared name apart by the chapter it was read in, after a move", () => {
    const cast = [member("a", "Georgiana", [0]), member("b", "Georgiana", [5])];
    const entities = projectWorld(cast, [read(5, [fact(5, "Georgiana", "kind", "trait")])], { order: new Map([["p5", 0]]) });
    expect(rowsOf(entities.find((e) => e.id === "b"))).toEqual(["Personality trait: kind"]);
  });

  it("chains each change, and lists the book in story order across people", () => {
    const cast = [member("m", "Mira", [0, 1, 2]), member("t", "Tobias", [0, 1])];
    const reads = [read(2, [fact(2, "Mira", "the inn", "location")]), read(0, [fact(0, "Mira", "the harbour", "location"), fact(0, "Tobias", "the mill", "location")]),
      read(1, [fact(1, "Mira", "the quay", "location"), fact(1, "Tobias", "the bridge", "location")])];
    expect(changes(reads, cast).map((c) => `${c.entityName}: ${c.from.value} -> ${c.to.value}`).sort()).toEqual(["Mira: the harbour -> the quay", "Mira: the quay -> the inn", "Tobias: the mill -> the bridge"]);
    expect(changes(reads, cast).map((c) => c.to.order)).toEqual([1, 1, 2]);
  });

  it("keeps a change per thing a person holds, not one list per dimension", () => {
    const cast = [member("m", "Mira", [0, 1]), member("k", "The key", [0, 1], { kind: "object" }), member("r", "The ring", [0, 1], { kind: "object" })];
    const hold = (order: number, value: string, counterpart: string) => fact(order, "Mira", value, "possession", { counterpart, span: { start: value.length + counterpart.length, end: 40 } });
    const list = changes([read(0, [hold(0, "holds", "The key"), hold(0, "holds", "The ring")]), read(1, [hold(1, "lost", "The key")])], cast);
    expect(list.map((c) => [c.label, c.from.value, c.to.value])).toEqual([["Possession of The key", "holds", "lost"]]);
  });

  it("holds in any language", () => {
    const [change] = changes([moved(0, "港"), moved(1, "宿")]);
    expect([change.from.value, change.to.value]).toEqual(["港", "宿"]);
  });

  it("gives every change its own key", () => {
    const list = changes([moved(0, "a"), moved(1, "b"), moved(2, "c")]);
    expect(new Set(list.map((c) => c.key)).size).toBe(2);
  });
});

describe("filterChanges", () => {
  const list = worldChanges(projectWorld([member("m", "Mira", [0, 1])], [read(0, [fact(0, "Mira", "the harbour", "location")]), read(1, [fact(1, "Mira", "the inn", "location")])]));
  it("searches who, what, and both values", () => {
    for (const query of ["mira", "LOCATION", "harbour", "inn", "  "]) expect(filterChanges(list, query)).toHaveLength(1);
    expect(filterChanges(list, "zzz")).toEqual([]);
  });
});

describe("filterWorld", () => {
  it("searches names, aliases, labels and values", () => {
    const entities = projectWorld([member("m", "Mira", [0], { properNames: ["Mira", "Miss Vale"] }), member("t", "Tobias", [0])], [read(0, [fact(0, "Mira", "green", "appearance:eye_color")])]);
    expect(filterWorld(entities, "people", "vale").map((e) => e.id)).toEqual(["m"]);
    expect(filterWorld(entities, "people", "GREEN").map((e) => e.id)).toEqual(["m"]);
    expect(filterWorld(entities, "people", "eye").map((e) => e.id)).toEqual(["m"]);
    expect(filterWorld(entities, "people", "zzz")).toEqual([]);
    expect(filterWorld(entities, "people", "  ")).toHaveLength(2);
  });
});
