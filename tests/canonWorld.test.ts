import { describe, expect, it } from "vitest";
import { buildCanonConflictView, readCanonConflictContext } from "@/helpers/canon/conflict";
import { canonMark, dimensionLabelFor, foundEntities, linkEntities, mergeRecord } from "@/helpers/canon/world";
import { emptyCanon, type CanonEntity, type CanonState, type CanonTracking } from "@/helpers/canon/record";
import { projectWorld, type WorldEntity } from "@/helpers/world";
import { lapsedPlan, lapsedTitle, planRead } from "@/helpers/account";
import { mergeCanonPass, pipelineV3PruneSets, type ReviewOutcome, type StoredClusterLike } from "@/helpers/reviewMerge";
import type { CastMember, ChapterRead, Fact } from "@/lib/contract/pipelineV3.types";
import type { EngineIssue } from "@/lib/contract/engine.types";

const member = (id: string, name: string, chapters: number[], extra: Partial<CastMember> = {}): CastMember => ({ id, name, kind: "person", names: [name], properNames: [name], aliases: [], chapters, roles: [], introduced: [], ...extra });
const fact = (order: number, subject: string, value: string, dimension: Fact["dimension"], extra: Partial<Fact> = {}): Fact => ({
  id: `${order}#${value}`, pageId: `p${order}`, order, span: { start: order, end: order + 5 }, quote: `quote ${value}`, paragraph: 0, subject, attribute: "attr", value, dimension,
  counterpart: null, status: "fact", kind: "trait", statement: "", question: "", framing: "narration", speaker: null, textMarksUntrue: false, ...extra });
const read = (order: number, facts: Fact[]): ChapterRead => ({ pageId: `p${order}`, order, rev: "r", facts, cast: [], narration: { person: "third", povCharacter: "", tense: "past" }, povBreaks: [], droppedFacts: 0 });
const writer = (declaredAt = "2026-03-12T00:00:00.000Z", from?: { pageId: string; pageOrder: number; quote?: string }) => ({ origin: "writer" as const, declaredAt, ...(from ? { from } : {}) });
const entity = (entityId: string, canonicalName: string, over: Partial<CanonEntity> = {}): CanonEntity => ({ entityId, canonicalName, type: "character", aliases: [], status: "active", provenance: [writer()], ...over });
const state = (stateId: string, entityId: string, dimension: string, value: string, over: Partial<CanonState> = {}): CanonState => ({ stateId, entityId, dimension, value, stability: "stable", openedAt: writer(), closedAt: null, ...over });
const canon = (entities: CanonEntity[], states: CanonState[] = []): CanonTracking => ({ ...emptyCanon(), entities: { version: 1, entities }, timeline: { version: 1, states } });
const coordinate = (pageId: string) => (pageId === "p0" ? "01 Arrival" : null);
const worldOf = (members: CastMember[], facts: Fact[] = []): WorldEntity[] => projectWorld(members, facts.map((f) => read(f.order, [f])));

describe("who a record entity is", () => {
  it("links through a name exactly one member and one entity hold", () => {
    const world = worldOf([member("r0", "Mira", [0]), member("r1", "Joe", [0])]);
    expect(linkEntities(world, canon([entity("ent_a", "mira")])).get("ent_a")?.id).toBe("r0");
  });
  it("links through a greppable alias, and a rename keeps the link", () => {
    const world = worldOf([member("r0", "Mira", [0])]);
    expect(linkEntities(world, canon([entity("ent_a", "Mira Vale", { aliases: [{ text: "Mira", kind: "nickname", grep: true }] })])).get("ent_a")?.id).toBe("r0");
    expect(linkEntities(world, canon([entity("ent_a", "Mira Vale", { aliases: [{ text: "Mira", kind: "epithet", grep: false }] })])).size).toBe(0);
  });
  it("never joins on a name two members share, or two entities claim", () => {
    const two = worldOf([member("r0", "Ann", [0]), member("r1", "Ann", [1], { id: "r1" })]);
    expect(linkEntities(two, canon([entity("ent_a", "Ann")])).size).toBe(0);
    const one = worldOf([member("r0", "Ann", [0])]);
    expect(linkEntities(one, canon([entity("ent_a", "Ann"), entity("ent_b", "ann")])).size).toBe(0);
  });
  it("a place is not a person of the same name", () => {
    const world = worldOf([member("r0", "Avalon", [0], { kind: "place" })]);
    expect(linkEntities(world, canon([entity("ent_a", "Avalon")])).size).toBe(0);
    expect(linkEntities(world, canon([entity("ent_a", "Avalon", { type: "location" })])).get("ent_a")?.id).toBe("r0");
  });
  it("links in any script", () => {
    for (const name of ["ミラ", "سلمى", "सलमा", "Мира"]) {
      expect(linkEntities(worldOf([member("r0", name, [0])]), canon([entity("ent_a", name)])).get("ent_a")?.id).toBe("r0");
    }
  });
  it("a hyphen is part of a name: Ann-Marie is not Ann Marie", () => {
    expect(linkEntities(worldOf([member("r0", "Ann Marie", [0])]), canon([entity("ent_a", "Ann-Marie")])).size).toBe(0);
  });
  it("two non-Latin names never collapse into one", () => {
    const world = worldOf([member("r0", "ミラ", [0]), member("r1", "セルマ", [0])]);
    expect(linkEntities(world, canon([entity("ent_a", "ミラ"), entity("ent_b", "セルマ")])).get("ent_b")?.id).toBe("r1");
  });
  it("hands the pen the found side with its link", () => {
    const world = worldOf([member("r0", "Mira", [0])], [fact(0, "Mira", "green", "appearance:eye_color")]);
    expect(foundEntities(world, canon([entity("ent_a", "Mira")]))[0]).toMatchObject({ worldId: "r0", canonId: "ent_a", pages: 1, page: { pageId: "p0", quote: "quote green" }, sample: { quote: "quote green" } });
    expect(foundEntities(world, emptyCanon())[0].canonId).toBeNull();
  });
});

describe("the record over what was found", () => {
  const world = worldOf([member("r0", "Mira", [0, 1], { names: ["Mira", "the captain"] })], [fact(0, "Mira", "green", "appearance:eye_color"), fact(1, "Mira", "the inn", "location")]);
  it("an open declaration outranks the found row of that dimension, and no other", () => {
    const [mira] = mergeRecord(world, canon([entity("ent_a", "Mira")], [state("st_a", "ent_a", "appearance:eye_color", "grey")]), coordinate);
    expect(mira.rows.map((r) => [r.label, r.value, r.origin, r.verb])).toEqual([["Location", "the inn", "found", "Make canon"], ["Eye colour", "grey", "canon", "Edit"]]);
  });
  it("a promoted fact takes its page's place and says Revert; a hand-typed one comes last", () => {
    const from = { pageId: "p0", pageOrder: 0, quote: "quote green" };
    const [mira] = mergeRecord(world, canon([entity("ent_a", "Mira")], [state("st_a", "ent_a", "appearance:eye_color", "green", { openedAt: writer(undefined, from) }), state("st_v", "ent_a", "voice", "low")]), coordinate);
    expect(mira.rows.map((r) => r.value)).toEqual(["green", "the inn", "low"]);
    expect(mira.rows[0]).toMatchObject({ verb: "Revert", mark: "canon · you · from 01 Arrival", found: null });
    expect(mira.rows[2].verb).toBe("Edit");
  });
  it("a closed declaration holds nothing", () => {
    const [mira] = mergeRecord(world, canon([entity("ent_a", "Mira")], [state("st_a", "ent_a", "appearance:eye_color", "grey", { closedAt: writer() })]), coordinate);
    expect(mira.rows.map((r) => r.value)).toEqual(["green", "the inn"]);
  });
  it("what is known holds its proposition, whatever the polarity", () => {
    const known = worldOf([member("r0", "Mira", [0])], [fact(0, "Mira", "the deed is forged", "knows")]);
    const t: CanonTracking = { ...canon([entity("ent_a", "Mira")]), knowledge: { version: 1, facts: [{ knowledgeId: "kn_a", entityId: "ent_a", proposition: "the deed is forged", propositionKey: "the_deed_is_forged", polarity: "suspects", learnedAt: writer() }] } };
    const [mira] = mergeRecord(known, t, coordinate);
    expect(mira.rows.map((r) => [r.label, r.origin])).toEqual([["Suspects", "canon"]]);
  });
  it("a found relationship is held by a declaration under the record's id for the other party", () => {
    const related = worldOf([member("r0", "Mira", [0]), member("r1", "Joe", [0])], [fact(0, "Mira", "sister", "relationship", { counterpart: "Joe" })]);
    const t = canon([entity("ent_m", "Mira"), entity("ent_j", "Joe")], [state("st_r", "ent_m", "relationship:ent_j", "cousin")]);
    expect(mergeRecord(related, t, coordinate).find((e) => e.name === "Mira")?.rows.map((r) => [r.label, r.value])).toEqual([["Relationship with Joe", "cousin"]]);
  });
  it("names the card by the record, and every other name stays an alias", () => {
    const [mira] = mergeRecord(world, canon([entity("ent_a", "Mira Vale", { aliases: [{ text: "Mira", kind: "nickname", grep: true }] })]), coordinate);
    expect(mira).toMatchObject({ id: "r0", canonId: "ent_a", name: "Mira Vale", writerTouched: true, scenes: 2 });
    expect(mira.aliases).toEqual(["Mira", "the captain"]);
  });
  it("lists someone a check has not found, ready to be written on; a found person is a found card", () => {
    const merged = mergeRecord(world, canon([entity("ent_b", "Odile")]), coordinate);
    expect(merged.map((e) => [e.name, e.canonId, e.scenes])).toEqual([["Mira", null, 2], ["Odile", "ent_b", 0]]);
    expect(merged[0].ref).toMatchObject({ found: { worldId: "r0" } });
    expect(merged[1].ref).toEqual({ canonId: "ent_b" });
  });
  it("hides nothing for an inactive entity, and lists it nowhere", () => {
    expect(mergeRecord([], canon([entity("ent_b", "Gone", { status: "retired" })]), coordinate)).toEqual([]);
  });
});

describe("marks and labels", () => {
  it("says where a promoted fact came from, else when it was declared, else who", () => {
    expect(canonMark(writer(undefined, { pageId: "p0", pageOrder: 0 }), coordinate)).toBe("canon · you · from 01 Arrival");
    expect(canonMark(writer(), coordinate)).toMatch(/^canon · you · \S+ \S+$/u);
    expect(canonMark(writer("nonsense"), coordinate)).toBe("canon · you");
    expect(canonMark(null, coordinate)).toBe("canon · you");
  });
  it("never shows an id: a named party is named, an unnamed one is left out", () => {
    expect(dimensionLabelFor("relationship:ent_x", (id) => (id === "ent_x" ? "Joe" : null))).toBe("Relationship with Joe");
    expect(dimensionLabelFor("relationship:ent_x", () => null)).toBe("Relationship with");
    expect(dimensionLabelFor("stance:the_deed", () => null)).toBe("Stance on the deed");
    expect(dimensionLabelFor("appearance:eye_color", () => null)).toBe("Eye colour");
    expect(dimensionLabelFor("object_state", () => null)).toBe("Object state");
  });
});

describe("a canon finding", () => {
  const context = { origin: "pipeline_v3", entityId: "ent_a", dimension: "appearance:eye_color", pinnedStateId: "st_a", pinnedValue: "grey", declaredAt: "2026-03-12T00:00:00.000Z", subject: "Mira" };
  const citation = (pageId: string, order: number) => ({ page_id: pageId, page_order: order, quoted_text: `quote ${pageId}`, evidence_role: "current_conflict", location_label: `Chapter ${order + 1}`, source_ref: { snapshotId: "s", pageId, rev: "r", start: 0, end: 5 } });
  const issue = (over: Partial<EngineIssue> = {}): EngineIssue => ({ issue_id: "i", type: "canon_conflict", severity: "error", message: "m", evidence_summary: "m", related_node_ids: [], issue_confidence: 1, context_json: JSON.stringify(context), citations: [citation("p0", 0)], ...over } as EngineIssue);
  const tracking = canon([entity("ent_a", "Mira Vale")], [state("st_a", "ent_a", "appearance:eye_color", "grey")]);
  const view = (i: EngineIssue, t = tracking) => buildCanonConflictView(i, t, (_, order) => order + 1, coordinate);

  it("reads as the desktop's card", () => {
    expect(view(issue())).toMatchObject({ title: "Ch. 1 contradicts canon", coordinate: "01 Arrival", factLabel: "Eye colour", factId: "Mira Vale · eye colour", pinned: true, more: [],
      target: { kind: "state", stateId: "st_a", entityId: "ent_a", dimension: "appearance:eye_color", value: "grey" } });
  });
  it("lists further passages, with the value when the engine paired one", () => {
    const two = view(issue({ citations: [citation("p0", 0), citation("p1", 1)], context_json: JSON.stringify({ ...context, conflictValues: ["green", "brown"] }) }));
    expect(two?.more.map((m) => m.line)).toEqual(["also ch2: brown"]);
    expect(view(issue({ citations: [citation("p0", 0), citation("p1", 1)] }))?.more.map((m) => m.line)).toEqual(["also ch2"]);
  });
  it("falls back to an ordinary card when it is half built, or not a canon finding", () => {
    expect(view(issue({ type: "trait_contradiction" }))).toBeNull();
    expect(view(issue({ citations: [] }))).toBeNull();
    expect(view(issue({ context_json: "{broken" }))).toBeNull();
    for (const missing of ["entityId", "dimension", "pinnedStateId", "pinnedValue"]) {
      const raw: Record<string, unknown> = { ...context }; delete raw[missing];
      expect(view(issue({ context_json: JSON.stringify(raw) }))).toBeNull();
    }
    expect(readCanonConflictContext("nope")).toBeNull();
  });
  it("knows when there is nothing left to revert: gone, or edited since", () => {
    expect(view(issue(), canon([entity("ent_a", "Mira")]))?.pinned).toBe(false);
    expect(view(issue(), canon([entity("ent_a", "Mira")], [state("st_a", "ent_a", "appearance:eye_color", "hazel")]))?.pinned).toBe(false);
    expect(view(issue(), emptyCanon())).toMatchObject({ pinned: false, factId: "Mira · eye colour" });
  });

  it("the prune branch: a pin gone or edited retires its card, an active one does not, and other findings are not touched", () => {
    const cluster = (over: Partial<StoredClusterLike> = {}): StoredClusterLike => ({ clusterKey: "c", type: "canon_conflict", evidence: [], context: { pageIds: ["p0"], rawContext: context }, ...over });
    const current = new Map([["p0", { rev: "r", text: "t" }]]);
    const pin = { entityId: "ent_a", dimension: "appearance:eye_color", value: "grey" };
    expect(pipelineV3PruneSets([cluster()], new Set(), new Set(), current, new Map([["st_a", pin]])).stale).toEqual([]);
    expect(pipelineV3PruneSets([cluster()], new Set(), new Set(), current, new Map()).stale).toEqual(["c"]);
    for (const edit of [{ value: "hazel" }, { dimension: "voice" }, { entityId: "ent_b" }]) {
      expect(pipelineV3PruneSets([cluster()], new Set(), new Set(), current, new Map([["st_a", { ...pin, ...edit }]])).stale).toEqual(["c"]);
    }
    expect(pipelineV3PruneSets([cluster()], new Set(["c"]), new Set(), current, new Map()).stale).toEqual([]);
    expect(pipelineV3PruneSets([cluster({ type: "trait_contradiction" })], new Set(), new Set(), current, new Map()).stale).toEqual([]);
  });

  it("a canon pass retires only what it did not find, only when it saw the whole book, and leaves the ledger alone", () => {
    const other = issue({ issue_id: "t", type: "trait_contradiction" });
    const prior = { issues: [issue({ issue_id: "old" }), other], pages: [{ pageId: "p0", sourceId: "s0", label: "a" }], ledger: { p0: { rev: "r", order: 0, policyId: "x", checkedAt: 1 } } } as unknown as ReviewOutcome;
    const base = { prior, edited: new Set<string>(), whole: true, statusOf: () => "open" as const, texts: new Map(), pages: [] };
    const none = mergeCanonPass({ ...base, issues: [] });
    expect(none).toMatchObject({ complete: true, retired: ["old"] });
    expect(none.review.issues.map((i) => i.issue_id)).toEqual(["t"]);
    expect(none.review.ledger).toBe(prior.ledger);
    expect(mergeCanonPass({ ...base, issues: [], whole: false })).toMatchObject({ complete: false, retired: [], message: expect.stringContaining("could not look at the whole book") });
    expect(mergeCanonPass({ ...base, issues: [], edited: new Set(["p9"]) })).toMatchObject({ complete: false, retired: [], message: expect.stringContaining("changed during") });
    // Only canon findings are stored, and not one on a chapter edited while it ran.
    const stray = mergeCanonPass({ ...base, issues: [issue({ issue_id: "n", citations: [citation("p9", 9)] }), other], edited: new Set(["p9"]) });
    expect(stray.review.issues.map((i) => i.issue_id)).toEqual(["old", "t"]);
  });
});

describe("a plan that ended", () => {
  it("is told apart from never having had one, and from a read that failed", () => {
    expect(lapsedPlan(null, { tier: "saga", renewsAt: null })).toBeNull();
    expect(lapsedPlan(planRead({ active: true, tier: "saga" }), { tier: "saga", renewsAt: null })).toBeNull();
    expect(lapsedPlan(planRead({ active: false }), null)).toBeNull();
    expect(lapsedPlan(planRead({ active: false }), { tier: "saga", renewsAt: "2026-03-12T00:00:00Z" })).toEqual({ plan: "Saga", endedAt: "2026-03-12T00:00:00Z" });
    expect(lapsedPlan(planRead({ active: false, tier: "quill", renewsAt: "2026-04-01T00:00:00Z" }), null)).toEqual({ plan: "Quill", endedAt: "2026-04-01T00:00:00Z" });
    expect(planRead("nope")).toBeNull();
    expect(planRead({ tier: "saga" })).toBeNull();
  });
  it("says so in the desktop's words", () => {
    expect(lapsedTitle({ plan: "Storyteller", endedAt: "2026-03-12T12:00:00Z" }, "en-GB")).toBe("Your Storyteller plan ended on 12 March.");
    expect(lapsedTitle({ plan: "Saga", endedAt: null })).toBe("Your Saga plan ended.");
    expect(lapsedTitle({ plan: "Saga", endedAt: "nonsense" })).toBe("Your Saga plan ended.");
  });
});
