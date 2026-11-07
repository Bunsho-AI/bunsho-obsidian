import { describe, expect, it } from "vitest";

import type { DirectorCastMember as CastMember } from "@/helpers/director/cast";
import type { DirectorSceneRecord as DirectorSceneCard } from "@/helpers/director/sceneCard";

import {
  exampleDirection,
  flaggedBeats,
  layoutScenes,
  passagesOf,
  rankedRecord,
  recordChapterSentence,
  rowStatus,
  writingStepMs,
} from "@/helpers/director/sceneView";

function scene(id: string, over: Partial<DirectorSceneCard> = {}): DirectorSceneCard {
  return {
    version: 1,
    sceneId: id,
    title: id,
    anchor: { pageId: "p1", placement: "append" },
    directorNotes: [],
    pov: { mode: "third_limited", tense: "past" },
    presence: [],
    goal: "g",
    beats: [],
    status: "drafting",
    ...over,
  };
}

const kept = { pageId: "p1", keptAtIso: "t" };

describe("layoutScenes", () => {
  it("shows the newest scene while it is unkept, frames a just-kept one, and lists the rest", () => {
    const scenes = [
      scene("unwritten-new"),
      scene("kept-new", { kept, checkOffer: true }),
      scene("unwritten-old"),
      scene("kept-old", { kept, checkOffer: false }),
    ];
    const layout = layoutScenes(scenes, null);
    expect(layout.current?.sceneId).toBe("unwritten-new");
    expect(layout.justKept?.sceneId).toBe("kept-new");
    expect(layout.earlier.map((s) => s.sceneId)).toEqual(["unwritten-old", "kept-old"]);
  });

  it("after Keep the box opens empty: an older unwritten scene stays in the list", () => {
    const layout = layoutScenes([scene("kept-new", { kept, checkOffer: true }), scene("unwritten-old")], null);
    expect(layout.current).toBeNull();
    expect(layout.justKept?.sceneId).toBe("kept-new");
    expect(layout.earlier.map((s) => s.sceneId)).toEqual(["unwritten-old"]);
  });

  it("a folded card leaves the box empty for a new direction", () => {
    const layout = layoutScenes([scene("a"), scene("b")], "none");
    expect(layout.current).toBeNull();
    expect(layout.earlier.map((s) => s.sceneId)).toEqual(["a", "b"]);
  });

  it("a reopened scene takes the card's place and the previous card folds into the list", () => {
    const scenes = [scene("a"), scene("b"), scene("c", { kept })];
    const layout = layoutScenes(scenes, "c");
    expect(layout.current?.sceneId).toBe("c");
    expect(layout.earlier.map((s) => s.sceneId)).toEqual(["a", "b"]);
  });
});

describe("rowStatus", () => {
  it("says kept, not written, or not kept for a draft waiting under its card", () => {
    expect(rowStatus(scene("a", { kept }))).toBe("kept");
    expect(rowStatus(scene("a"))).toBe("unwritten");
    expect(rowStatus(scene("a", { draft: { text: "x", wordCount: 1, spans: [] } }))).toBe("drafted");
  });
});

describe("the record", () => {
  const chapters = { p2: { title: "Chapter Two", ordinal: 2 } };

  it("names the chapter the fact comes from, pinned or read", () => {
    expect(recordChapterSentence({ rank: "canon", message: "m", pageId: "p2" }, chapters)).toBe("Pinned in Chapter Two.");
    expect(recordChapterSentence({ rank: "found", message: "m", pageId: "p2" }, chapters)).toBe("Read in Chapter Two.");
    expect(recordChapterSentence({ rank: "canon", message: "m" }, chapters)).toBe("Pinned in the World.");
    expect(recordChapterSentence({ rank: "found", message: "m" }, chapters)).toBeNull();
  });

  it("ranks canon first and flags the beats it names", () => {
    const record = [
      { rank: "found" as const, message: "f", beatOrder: 3 },
      { rank: "canon" as const, message: "c", beatOrder: 2 },
    ];
    expect(rankedRecord(record).map((l) => l.rank)).toEqual(["canon", "found"]);
    expect([...flaggedBeats(record)]).toEqual([3, 2]);
  });
});

describe("passagesOf", () => {
  it("splits each beat's passage into its paragraphs", () => {
    expect(
      passagesOf({
        text: "One.\n\nTwo a.\n\nTwo b.",
        wordCount: 4,
        spans: [
          { beatId: "bt_1", beatOrder: 1, start: 0, end: 4 },
          { beatId: "bt_2", beatOrder: 2, start: 6, end: 20 },
        ],
      }),
    ).toEqual([
      { beatId: "bt_1", beatOrder: 1, paragraphs: ["One."] },
      { beatId: "bt_2", beatOrder: 2, paragraphs: ["Two a.", "Two b."] },
    ]);
  });
});

describe("exampleDirection", () => {
  const member = (name: string, tier: "main" | "extra"): CastMember => ({
    entityId: name,
    name,
    aliases: [],
    appearances: 1,
    tier,
    handCreated: false,
  });

  it("is written with the book's own cast, main characters first", () => {
    expect(exampleDirection([member("Juna", "extra"), member("Selma", "main"), member("Mira", "main")], false)).toBe(
      "Selma finally tells Mira the truth. Mira does not take it well.",
    );
    expect(exampleDirection([], false)).toBe("Say what happens in the scene and who is there.");
    expect(exampleDirection([member("Selma", "main")], true)).toBe("Direct the next scene");
  });
});

describe("writingStepMs", () => {
  it("walks the beats in turn across the expected length of the call", () => {
    expect(writingStepMs(5)).toBe(7_600);
    expect(writingStepMs(1)).toBe(14_000);
  });
});
