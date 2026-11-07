import { describe, expect, it } from "vitest";
import { writerPinDigest, writerPins } from "@/helpers/canon/pins";
import { sha256 } from "@/utils/hash";
import type { CanonTracking } from "@/helpers/canon/record";

const pageSource = { pageId: "p", pageOrder: 0, quote: "She was thirty." };
const writer = { origin: "writer" as const, declaredAt: "2026-09-09T00:00:00Z", from: pageSource };
const tracking = (): CanonTracking => ({
  entities: { version: 1, entities: [{ entityId: "e", canonicalName: "Ada", type: "character", status: "confirmed", aliases: [{ text: "Grandma", kind: "title", grep: true }], provenance: [pageSource] },
    { entityId: "unrelated", canonicalName: "Someone Else", type: "character", status: "confirmed", aliases: [], provenance: [] }] },
  timeline: { version: 1, states: [
    { stateId: "pin", entityId: "e", dimension: "age", value: "thirty", stability: "stable", openedAt: writer },
    { stateId: "extract", entityId: "e", dimension: "hair", value: "brown", stability: "stable", openedAt: pageSource },
    { stateId: "closed", entityId: "e", dimension: "age", value: "twenty", stability: "stable", openedAt: writer, closedAt: writer },
    { stateId: "dynamic", entityId: "e", dimension: "mood", value: "sad", stability: "dynamic", openedAt: writer },
  ] },
  knowledge: { version: 1, facts: [{ knowledgeId: "k", entityId: "e", proposition: "the deed is forged", propositionKey: "the_deed_is_forged", polarity: "knows", learnedAt: writer }] },
});

describe("the writer's pins (the desktop's readerTracking.test.ts)", () => {
  it("matches the engine's constraint identity and ignores unrelated data, aliases and source history", () => {
    const value = tracking();
    const expected = [{ constraintId: "pin", entityId: "e", entityName: "Ada", dimension: "age", value: "thirty", declaredAt: writer.declaredAt }];
    expect(writerPinDigest(value)).toBe(sha256(JSON.stringify(expected)));
    const edited: CanonTracking = { ...value,
      entities: { ...value.entities, entities: value.entities.entities.map((e) => ({ ...e, aliases: [], canonicalName: e.entityId === "unrelated" ? "Renamed Unrelated" : e.canonicalName })) },
      timeline: { ...value.timeline, states: value.timeline.states.map((s) => ({ ...s, ...(s.stateId === "pin" ? { openedAt: { ...writer, from: { ...pageSource, quote: "Historical prose changed" } } } : { value: "changed" }) })) },
    };
    expect(writerPinDigest(edited)).toBe(writerPinDigest(value));
  });

  it.each(["constraintId", "entityId", "entityName", "dimension", "value", "declaredAt", "closedAt"])("changes its identity when an active constraint's %s changes", (field) => {
    const value = tracking();
    const edited = structuredClone(value);
    const [pin] = edited.timeline.states;
    if (field === "entityName") edited.entities.entities[0].canonicalName = "Nadia";
    else if (field === "declaredAt") pin.openedAt = { ...writer, declaredAt: "2026-09-10T00:00:00Z" };
    else if (field === "closedAt") pin.closedAt = pageSource;
    else if (field === "constraintId") pin.stateId = "different";
    else if (field === "entityId") pin.entityId = "different";
    else if (field === "dimension") pin.dimension = "different";
    else pin.value = "different";
    expect(writerPinDigest(edited)).not.toBe(writerPinDigest(value));
  });

  it("sorts by identity, and keeps a missing entity as the engine's Unnamed entity", () => {
    const value = tracking();
    const extra = { ...value.timeline.states[0], stateId: "aaa", entityId: "missing" };
    const ordered = { ...value, timeline: { ...value.timeline, states: [extra, ...value.timeline.states] } };
    expect(writerPinDigest(ordered)).toBe(writerPinDigest({ ...ordered, timeline: { ...ordered.timeline, states: [...ordered.timeline.states].reverse() } }));
    expect(writerPins(ordered)[0]).toMatchObject({ pinId: "aaa", entityName: "Unnamed entity" });
  });

  it("sends open, stable, writer-sourced states alone, named but with no aliases: never knowledge, never a dynamic fact", () => {
    expect(writerPins(tracking())).toEqual([{ pinId: "pin", entityId: "e", entityName: "Ada", aliases: [], dimension: "age", value: "thirty", declaredAt: writer.declaredAt }]);
  });

  it("carries a pin in any script exactly as typed", () => {
    const value = tracking();
    value.entities.entities[0].canonicalName = "ミラ";
    value.timeline.states[0].value = "緑の目";
    expect(writerPins(value)[0]).toMatchObject({ entityName: "ミラ", value: "緑の目" });
    expect(writerPinDigest(value)).not.toBe(writerPinDigest(tracking()));
  });

  it("validates malformed input before deriving from it", () => {
    for (const input of [null, {}, { ...tracking(), timeline: { version: 1, states: [null] } }]) {
      expect(() => writerPinDigest(input)).toThrow("Invalid reader tracking");
      expect(() => writerPins(input)).toThrow("Invalid reader tracking");
    }
  });
});
