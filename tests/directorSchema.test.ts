/** The projection against what the engine's edge takes, checked first against a real tracking bundle from the engine's own bench fixture. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { trackingProblem } from "../scripts/engine-schema.mjs";
import { addEntity, addFact } from "@/helpers/canon/pen";
import { emptyCanon, type CanonTracking } from "@/helpers/canon/record";
import { projectPipelineV3World, seedTracking } from "@/helpers/director/world";
import type { CastMember, ChapterRead } from "@/lib/contract/pipelineV3.types";

const REAL = JSON.parse(readFileSync(new URL("./fixtures/engine-tracking.json", import.meta.url), "utf8")) as Record<string, unknown>;
const context = { now: "2026-11-05T00:00:00.000Z", found: [] };

function declared(): CanonTracking {
  const made = addEntity(emptyCanon(), context, { canonicalName: "ミラ", type: "character", aliases: [] });
  if (!made.success) throw new Error(made.error);
  const id = made.data.entityId;
  const fact = addFact(made.tracking, context, { entity: { canonId: id }, fact: { kind: "state", dimension: "appearance:eye_color", value: "緑" } });
  return fact.success ? fact.tracking : made.tracking;
}
const read: ChapterRead = { pageId: "p1", order: 0, rev: "r1", droppedFacts: 0, povBreaks: [], narration: { person: "third", povCharacter: "", tense: "past" },
  facts: [{ id: "p1#0", pageId: "p1", order: 0, span: { start: 0, end: 5 }, quote: "彼女の目は緑だった。", paragraph: 0, subject: "ミラ", attribute: "目の色", kind: "trait", statement: "s", question: "q", framing: "narration", speaker: null, textMarksUntrue: false, dimension: "appearance:eye_color", value: "緑" }],
  cast: [{ pageId: "p1", order: 0, name: "ミラ", kind: "person", names: [{ name: "ミラ", proper: true }], role: "", introducedAliases: [] }] } as unknown as ChapterRead;
const cast: CastMember[] = [{ id: "c0", name: "ミラ", kind: "person", names: ["ミラ"], properNames: ["ミラ"], aliases: [], chapters: [0], roles: [], introduced: [] }] as unknown as CastMember[];

describe("the tracking a Director request carries", () => {
  it("the schema takes a real engine bundle, and refuses what the engine refuses", () => {
    expect(trackingProblem(REAL)).toBeNull();
    expect(trackingProblem({ ...REAL, timeline: { version: 1, states: [] } })).toBe("timeline");
    expect(trackingProblem({ ...REAL, pov: undefined })).toMatch(/four files/u);
  });
  it("is complete with no canon and no reads, as the first plan of a book is", () => {
    expect(trackingProblem(seedTracking(emptyCanon()))).toBeNull();
  });
  it("a declared record the plugin stores travels in the shape the engine takes, in any script", () => {
    const tracking = seedTracking(declared());
    expect(trackingProblem(tracking)).toBeNull();
    expect(tracking.entities.entities[0].canonicalName).toBe("ミラ");
  });
  it("a promoted fact's page, which the plugin may hold without a quote, still has one on the wire", () => {
    const canon = declared();
    const state = canon.timeline.states[0];
    const bare: CanonTracking = state ? { ...canon, timeline: { version: 1, states: [{ ...state, openedAt: { origin: "writer", declaredAt: "d", from: { pageId: "p", pageOrder: 1 } } }] } } : canon;
    expect(trackingProblem(seedTracking(bare))).toBeNull();
  });
  it("what the projection adds is what the engine takes, for the real bundle and for a non-Latin book", () => {
    const out = projectPipelineV3World({ tracking: seedTracking(declared()), cast, reads: [read], pageOrder: new Map([["p1", 0]]) });
    expect(out.timeline.states.length).toBeGreaterThan(0);
    expect(trackingProblem(out)).toBeNull();
    const real = projectPipelineV3World({ tracking: REAL as never, cast, reads: [read], pageOrder: new Map([["p1", 0]]) });
    expect(trackingProblem(real)).toBeNull();
  });
});
