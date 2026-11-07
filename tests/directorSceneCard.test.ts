import { describe, expect, it } from "vitest";

import type { EngineBeat, EngineBeatSheet } from "@/lib/contract/director.types";
import {
  applyBeatEdits,
  applyDiscard,
  applyDraft,
  applyKept,
  applyRegenerated,
  applyRegeneratedBeat,
  applyRewrite,
  isKept,
  joinPassages,
  newSceneRecord,
  rewriteContext,
  swapPrevious,
  toEngineSheet,
  uniqueSceneId,
  type DirectorSceneRecord,
} from "@/helpers/director/sceneCard";

function beat(n: number, over: Partial<EngineBeat> = {}): EngineBeat {
  return {
    beatId: `bt_${n}`,
    order: n,
    intent: `Beat ${n} happens.`,
    turn: `Change ${n}.`,
    pacing: "standard",
    entityIds: ["ent_mira"],
    knowledgeEffects: [
      { entityId: "ent_mira", propositionKey: `k${n}`, proposition: `fact ${n}`, polarity: "knows" },
    ],
    stateEffects: [],
    directions: [],
    status: "planned",
    ...over,
  };
}

function sheet(over: Partial<EngineBeatSheet> = {}): EngineBeatSheet {
  return {
    version: 1,
    sceneId: "sc_the_letter",
    title: "The letter",
    description: "The customs house at night. Selma brings Mira the letter.",
    anchor: { pageId: "p1", placement: "append" },
    directorNotes: ["Selma shows Mira the letter."],
    pov: { mode: "third_limited", tense: "past" },
    presence: [],
    goal: "Mira learns the letter was forged",
    beats: [beat(1), beat(2), beat(3)],
    status: "drafting",
    ...over,
  };
}

function record(over: Partial<DirectorSceneRecord> = {}): DirectorSceneRecord {
  return { ...sheet(), direction: "Selma shows Mira the letter.", record: [], ...over };
}

const written = {
  text: "One.\n\nTwo a.\n\nTwo b.\n\nThree.",
  wordCount: 4,
  spans: [
    { beatId: "bt_1", beatOrder: 1, start: 0, end: 4 },
    { beatId: "bt_2", beatOrder: 2, start: 6, end: 20 },
    { beatId: "bt_3", beatOrder: 3, start: 22, end: 28 },
  ],
};

describe("newSceneRecord / uniqueSceneId", () => {
  it("never lets a new direction overwrite another scene's file", () => {
    const planned = newSceneRecord(sheet(), {
      direction: "Selma shows Mira the letter.",
      nowIso: "2026-09-28T10:00:00.000Z",
      takenIds: new Set(["sc_the_letter", "sc_the_letter_2"]),
    });
    expect(planned.sceneId).toBe("sc_the_letter_3");
    expect(planned.direction).toBe("Selma shows Mira the letter.");
    expect(planned.createdAtIso).toBe("2026-09-28T10:00:00.000Z");
    expect(uniqueSceneId("sc_new", new Set())).toBe("sc_new");
  });
});

describe("toEngineSheet", () => {
  it("strips every desktop-only field before a scene travels to the engine", () => {
    const stored = record({
      note: "slower",
      previous: { goal: "g", beats: [] },
      showingPrevious: false,
      draft: { text: "x", wordCount: 1, spans: [] },
      kept: { pageId: "p1", keptAtIso: "t" },
      checkOffer: true,
    });
    const wire = toEngineSheet(stored) as unknown as Record<string, unknown>;
    for (const key of ["direction", "note", "previous", "showingPrevious", "draft", "kept", "checkOffer"]) {
      expect(wire).not.toHaveProperty(key);
    }
    expect(wire.description).toBe(stored.description);
    expect(wire.beats).toEqual(stored.beats);
  });
});

describe("applyRegenerated", () => {
  it("replaces the card in place and keeps exactly one previous card, with its hand edits", () => {
    const edited = applyBeatEdits(record(), [{ beatId: "bt_1", intent: "Selma waits by the door." }]);
    const planned = sheet({ title: "The letter, slower", beats: [beat(1), beat(2), beat(3), beat(4)] });
    const once = applyRegenerated(edited, planned, { note: "slower" });
    expect(once.sceneId).toBe("sc_the_letter");
    expect(once.title).toBe("The letter, slower");
    expect(once.note).toBe("slower");
    expect(once.previous?.beats.map((b) => b.intent)).toEqual(["Selma waits by the door."]);

    const twice = applyRegenerated(once, sheet({ title: "Third" }), {});
    expect(twice.previous?.title).toBe("The letter, slower");
    expect(twice.previous?.note).toBe("slower");
    expect(twice.note).toBeUndefined();
  });

  it("an edited direction becomes the card's direction", () => {
    const next = applyRegenerated(record(), sheet(), { direction: "Mira finds the letter herself." });
    expect(next.direction).toBe("Mira finds the letter herself.");
  });
});

describe("swapPrevious", () => {
  it("swaps the card on show with the previous one, and back", () => {
    const regenerated = applyRegenerated(record(), sheet({ title: "Newer" }), { note: "n" });
    const older = swapPrevious(regenerated);
    expect(older.title).toBe("The letter");
    expect(older.showingPrevious).toBe(true);
    expect(older.note).toBeUndefined();
    const newer = swapPrevious(older);
    expect(newer.title).toBe("Newer");
    expect(newer.note).toBe("n");
    expect(newer.showingPrevious).toBe(false);
  });

  it("does nothing without a previous card", () => {
    const scene = record();
    expect(swapPrevious(scene)).toBe(scene);
  });
});

describe("applyRegeneratedBeat", () => {
  it("replaces only that row and keeps its position", () => {
    const planned = sheet({ beats: [beat(1), beat(2, { intent: "Mira laughs." }), beat(3)] });
    const next = applyRegeneratedBeat(record(), { ...planned, beats: [beat(2, { order: 9, intent: "Mira laughs." })] }, "bt_2");
    expect(next.beats.map((b) => b.intent)).toEqual(["Beat 1 happens.", "Mira laughs.", "Beat 3 happens."]);
    expect(next.beats[1].order).toBe(2);
  });

  it("refuses a plan without the beat", () => {
    expect(() => applyRegeneratedBeat(record(), sheet({ beats: [] }), "bt_2")).toThrow();
  });
});

describe("applyBeatEdits", () => {
  it("rewording a beat drops its effects and change line, which described the planner's version", () => {
    const next = applyBeatEdits(record(), [
      { beatId: "bt_1", intent: "Beat 1 happens." },
      { beatId: "bt_2", intent: "Selma burns the letter instead." },
      { beatId: "bt_3", intent: "Beat 3 happens." },
    ]);
    expect(next.beats[0]).toEqual(beat(1));
    expect(next.beats[1].intent).toBe("Selma burns the letter instead.");
    expect(next.beats[1].knowledgeEffects).toEqual([]);
    expect(next.beats[1]).not.toHaveProperty("turn");
  });

  it("reorders, removes and adds, renumbering in order with fresh ids for new beats", () => {
    const next = applyBeatEdits(record(), [
      { beatId: "bt_3", intent: "Beat 3 happens." },
      { beatId: "bt_1", intent: "Beat 1 happens." },
      { intent: "Mira goes to the window." },
      { intent: "   " },
    ]);
    expect(next.beats.map((b) => [b.beatId, b.order])).toEqual([
      ["bt_3", 1],
      ["bt_1", 2],
      ["bt_4", 3],
    ]);
    expect(next.beats[2]).toMatchObject({ intent: "Mira goes to the window.", knowledgeEffects: [], status: "planned" });
  });

  it("drops record lines about edited or removed beats and renumbers the rest", () => {
    const scene = record({
      record: [
        { rank: "canon", beatId: "bt_1", beatOrder: 1, message: "one" },
        { rank: "found", beatId: "bt_2", beatOrder: 2, message: "two" },
        { rank: "found", beatId: "bt_3", beatOrder: 3, message: "three" },
        { rank: "found", message: "whole scene" },
      ],
    });
    const next = applyBeatEdits(scene, [
      { beatId: "bt_3", intent: "Beat 3 happens." },
      { beatId: "bt_2", intent: "Changed." },
    ]);
    expect(next.record?.map((l) => [l.message, l.beatOrder])).toEqual([
      ["three", 1],
      ["whole scene", undefined],
    ]);
  });
});

describe("drafts", () => {
  it("applyDraft keeps the whole draft and each beat's passage", () => {
    const next = applyDraft(record(), written);
    expect(next.draft).toEqual(written);
    expect(next.beats.map((b) => b.renderedProse)).toEqual(["One.", "Two a.\n\nTwo b.", "Three."]);
    expect(next.beats.every((b) => b.status === "rendered")).toBe(true);
  });

  it("applyRewrite replaces one passage and shifts the others", () => {
    const drafted = applyDraft(record(), written);
    const next = applyRewrite(drafted, "bt_2", "  A new middle.  ", "colder");
    expect(next.draft?.text).toBe("One.\n\nA new middle.\n\nThree.");
    expect(next.draft?.spans.map((s) => next.draft!.text.slice(s.start, s.end))).toEqual([
      "One.",
      "A new middle.",
      "Three.",
    ]);
    expect(next.draft?.wordCount).toBe(5);
    expect(next.beats[1].directions).toEqual(["colder"]);
    expect(next.beats[1].renderedProse).toBe("A new middle.");
  });

  it("rewriteContext gives the chapter plus earlier passages before, and the next passage after", () => {
    expect(rewriteContext(written, "bt_2", "The chapter so far.")).toEqual({
      precedingProse: "The chapter so far.\n\nOne.",
      followingProse: "Three.",
    });
    expect(rewriteContext(written, "bt_3", "").followingProse).toBe("");
  });

  it("applyDiscard truly discards: no draft, no prose, unwritten again", () => {
    const next = applyDiscard(applyDraft(record(), written));
    expect(next.draft).toBeUndefined();
    expect(next.beats.every((b) => b.renderedProse === undefined && b.status === "planned")).toBe(true);
    expect(isKept(next)).toBe(false);
  });

  it("applyKept ties each beat to its passage, lets the previous card go and opens the check offer", () => {
    const regenerated = applyRegenerated(record(), sheet(), { note: "n" });
    const next = applyKept(applyDraft(regenerated, written), "p2", "2026-09-28T11:00:00.000Z");
    expect(next.kept).toEqual({ pageId: "p2", keptAtIso: "2026-09-28T11:00:00.000Z" });
    expect(next.anchor.pageId).toBe("p2");
    expect(next.checkOffer).toBe(true);
    expect(next.previous).toBeUndefined();
    expect(next.beats.every((b) => b.status === "accepted" && /^[0-9a-f]{64}$/.test(b.renderedRev ?? ""))).toBe(true);
    expect(isKept(next)).toBe(true);
  });

  it("joinPassages builds spans over the joined text", () => {
    expect(joinPassages([
      { beatId: "a", beatOrder: 1, text: "Hi." },
      { beatId: "b", beatOrder: 2, text: "Yes." },
    ])).toEqual({
      text: "Hi.\n\nYes.",
      wordCount: 2,
      spans: [
        { beatId: "a", beatOrder: 1, start: 0, end: 3 },
        { beatId: "b", beatOrder: 2, start: 5, end: 9 },
      ],
    });
  });
});

describe("isKept", () => {
  it("counts a scene from the per-beat flow as kept once any beat reached the page", () => {
    expect(isKept(record({ beats: [beat(1, { status: "accepted" }), beat(2)] }))).toBe(true);
    expect(isKept(record())).toBe(false);
  });
});
