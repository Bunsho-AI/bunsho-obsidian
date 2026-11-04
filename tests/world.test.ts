import { describe, expect, it } from "vitest";
import { filterWorld, projectWorld } from "@/helpers/world";
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

  it("maps cast kinds to people, places and things", () => {
    const kinds = ["person", "place", "building", "vessel", "animal", "object", "group"] as const;
    const entities = projectWorld(kinds.map((kind) => member(kind, kind, [0], { kind })), []);
    const names = (filter: "people" | "places" | "things") => filterWorld(entities, filter, "").map((e) => e.name).sort();
    expect(names("people")).toEqual(["person"]);
    expect(names("places")).toEqual(["building", "place"]);
    expect(names("things")).toEqual(["animal", "group", "object", "vessel"]);
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
