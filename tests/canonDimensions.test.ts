/**
 * Canon by hand — the structured dimension vocabulary. Asserts that every
 * key round-trips through build/parse, that the keys ARE the engine's
 * conventions (string equality against the DIMENSION CONVENTIONS comment in
 * bunsho-engine/src/types/tracking.ts — a hand-typed `appearance:eye_color`
 * lands in the same `${entityId}\0${dimension}` guard bucket as an
 * extracted one, rules.service.ts stableTraitConflict / canonConflict), and
 * that the topic / proposition keys are structural, not Latin-bound.
 */
import { describe, expect, it } from "vitest";

import {
  CANON_DIMENSIONS,
  DIMENSION_GROUPS,
  KNOWLEDGE_POLARITIES,
  LEGACY_DIMENSION_KEYS,
  buildDimensionKey,
  capKey,
  dimensionEntry,
  dimensionKey,
  dimensionLabel,
  isKnowledgePolarity,
  knowledgeDimensionEntries,
  needsDetail,
  isLegacyDimensionKey,
  isVocabularyDimension,
  parseDimensionKey,
  propositionKeyOf,
  stateDimensionEntries,
  topicKey,
} from "@/helpers/canon/dimensions";
const STABILITY = { STABLE: "stable", DYNAMIC: "dynamic" } as const;

/**
 * bunsho-engine/src/types/tracking.ts, "DIMENSION CONVENTIONS for StateRecord.dimension":
 *   physical:      "injury", "appearance:<attr>" (e.g. "appearance:eye_color", "appearance:hair"),
 *                  "location", "possession:<object entityId>"
 *   semantic:      "motivation", "stance:<topic>", "relationship:<other entityId>",
 *                  "voice" (register/cadence notes)
 * (`object_state` / `object_meaning` are engine conventions the hand
 * vocabulary does NOT offer — design 15b canonDimensions.js is the table;
 * they read back raw through humanDimension.)
 */
const ENGINE_CONVENTION_KEYS = [
  "injury",
  "appearance:eye_color",
  "appearance:hair",
  "location",
  "motivation",
  "voice",
];
const ENGINE_CONVENTION_FAMILIES = ["possession", "stance", "relationship"];

describe("canon dimension vocabulary", () => {
  it("has unique keys, four knowledge entries (the polarities), and every state entry a default stability that is an engine literal", () => {
    const keys = CANON_DIMENSIONS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(knowledgeDimensionEntries().map((e) => e.key)).toEqual([...KNOWLEDGE_POLARITIES]);
    for (const entry of knowledgeDimensionEntries()) expect(entry.polarity).toBe(entry.key);
    for (const entry of stateDimensionEntries()) {
      expect([STABILITY.STABLE, STABILITY.DYNAMIC]).toContain(entry.stability);
    }
    for (const entry of CANON_DIMENSIONS) expect(entry.label.length).toBeGreaterThan(0);
    expect(KNOWLEDGE_POLARITIES).toEqual(["knows", "suspects", "believes_false", "unaware"]);
    expect(isKnowledgePolarity("believes_false")).toBe(true);
    expect(isKnowledgePolarity("doubts")).toBe(false);
  });

  it("IS design 15b's canonDimensions.js: four groups, the same keys and labels in order, detail on exactly the two-part three, knowledge grouped as kind knowledge", () => {
    expect(DIMENSION_GROUPS.map((g) => [g.id, g.label, g.kind ?? null])).toEqual([
      ["appearance", "Appearance", null],
      ["character", "Character", null],
      ["circumstance", "Circumstance", null],
      ["knowledge", "What they know", "knowledge"],
    ]);
    expect(DIMENSION_GROUPS.map((g) => g.items.map((e) => [e.key, e.label, e.detail ?? null]))).toEqual([
      [
        ["appearance:eye_color", "Eye colour", null],
        ["appearance:hair", "Hair", null],
        ["appearance:build", "Build", null],
        ["appearance:age", "Age", null],
        ["appearance:height", "Height", null],
        ["appearance:distinguishing_mark", "Distinguishing mark", null],
      ],
      [
        ["trait", "Personality trait", null],
        ["motivation", "Motivation", null],
        ["voice", "Voice", null],
      ],
      [
        ["location", "Location", null],
        ["injury", "Injury", null],
        ["possession", "Possession of", "object"],
        ["relationship", "Relationship with", "entity"],
        ["stance", "Stance on", "topic"],
      ],
      [
        ["knows", "Knows", null],
        ["suspects", "Suspects", null],
        ["believes_false", "Believes false", null],
        ["unaware", "Unaware of", null],
      ],
    ]);
    expect(CANON_DIMENSIONS.filter((e) => needsDetail(e.key)).map((e) => e.key)).toEqual(["possession", "relationship", "stance"]);
    // Object-entity engine keys are NOT in the hand vocabulary (they read back raw).
    expect(dimensionEntry("object_state")).toBeUndefined();
    expect(dimensionEntry("object_meaning")).toBeUndefined();
  });

  it("dimensionLabel looks a row's label up (never parses it) and falls back to the caller's humaniser only outside the table", () => {
    expect(dimensionLabel("appearance:eye_color")).toBe("Eye colour");
    expect(dimensionLabel("trait")).toBe("Personality trait");
    expect(dimensionLabel("unaware")).toBe("Unaware of");
    expect(dimensionLabel("relationship:ent_mira", { detailLabel: "Mira Vale" })).toBe("Relationship with Mira Vale");
    expect(dimensionLabel("stance:the_harbour_deed", { detailLabel: "the harbour deed" })).toBe("Stance on the harbour deed");
    // no detailLabel resolved: the raw suffix, underscores spaced (canonDimensions.js)
    expect(dimensionLabel("stance:the_harbour_deed")).toBe("Stance on the harbour deed");
    expect(dimensionLabel("relationship")).toBe("Relationship with");
    expect(dimensionLabel("relationship", { detailLabel: "Mira Vale" })).toBe("Relationship with Mira Vale");
    // outside the table: the fallback, else underscores spaced
    expect(dimensionLabel("object_state")).toBe("object state");
    expect(dimensionLabel("appearance:scars", { fallback: (k) => `H(${k})` })).toBe("H(appearance:scars)");
    // the resolved key the composer shows at its right
    expect(dimensionKey("appearance:height")).toBe("appearance:height");
    expect(dimensionKey("relationship")).toBe("relationship");
    expect(dimensionKey("relationship", "ent_mira")).toBe("relationship:ent_mira");
    expect(dimensionKey("stance", "The Harbour Deed")).toBe("stance:the_harbour_deed");
    expect(dimensionKey("knows")).toBe("knows");
  });

  it("mirrors the engine's DIMENSION CONVENTIONS by string equality — a hand-typed key groups with an extracted one", () => {
    for (const key of ENGINE_CONVENTION_KEYS) {
      const entry = dimensionEntry(key);
      expect(entry, key).toBeDefined();
      expect(buildDimensionKey(entry!)).toBe(key);
      // The guard bucket key the engine builds (`${entityId}\0${dimension}`) is identical either way.
      expect(`ent_selma\0${buildDimensionKey(entry!)}`).toBe(`ent_selma\0${key}`);
    }
    for (const family of ENGINE_CONVENTION_FAMILIES) {
      const entry = dimensionEntry(family);
      expect(entry, family).toBeDefined();
      expect(entry!.param).not.toBe("none");
    }
    // Entity params are the raw entityId — the join the engine's convention names.
    expect(buildDimensionKey(dimensionEntry("possession")!, "ent_locket")).toBe("possession:ent_locket");
    expect(buildDimensionKey(dimensionEntry("relationship")!, "ent_mira_vale")).toBe("relationship:ent_mira_vale");
  });

  it("round-trips every key through build → parse (unparametrised, entity, topic)", () => {
    for (const entry of stateDimensionEntries()) {
      const param = entry.param === "entity" ? "ent_9f3c2b1e-7a4d-4c2a-9b0e-2f6d8a1c5e44" : entry.param === "topic" ? "the harbour deed" : undefined;
      const key = buildDimensionKey(entry, param);
      expect(key, entry.key).not.toBeNull();
      const parsed = parseDimensionKey(key!);
      expect(parsed?.entry).toBe(entry);
      if (entry.param === "none") expect(parsed?.param).toBeNull();
      if (entry.param === "entity") expect(parsed?.param).toBe(param);
      if (entry.param === "topic") expect(parsed?.param).toBe(topicKey(param!));
      // Re-building from the parse gives the same key (idempotent).
      expect(buildDimensionKey(parsed!.entry, parsed!.param ?? undefined)).toBe(key);
    }
  });

  it("parses `appearance:eye_color` as ONE entry, never as family `appearance` + param", () => {
    expect(parseDimensionKey("appearance:eye_color")).toEqual({ entry: dimensionEntry("appearance:eye_color"), param: null });
    // "appearance" is not a family; an unknown attribute is engine-only, not composable.
    expect(parseDimensionKey("appearance:scars")).toBeNull();
    expect(parseDimensionKey("appearance")).toBeNull();
    expect(isVocabularyDimension("appearance:scars")).toBe(false);
  });

  it("refuses a parametrised entry without its param and the knowledge entry as a dimension", () => {
    expect(buildDimensionKey(dimensionEntry("relationship")!)).toBeNull();
    expect(buildDimensionKey(dimensionEntry("relationship")!, "  ")).toBeNull();
    expect(buildDimensionKey(dimensionEntry("stance")!, " \t ")).toBeNull();
    expect(buildDimensionKey(dimensionEntry("knows")!)).toBeNull();
    expect(parseDimensionKey("relationship:")).toBeNull();
    expect(parseDimensionKey("knows")).toBeNull();
    expect(parseDimensionKey("knowledge")).toBeNull();
    expect(parseDimensionKey(":x")).toBeNull();
  });

  it("topic / proposition keys are structural: NFC + trim + lowercase + whitespace→underscore, any script", () => {
    expect(topicKey("  The Harbour   Deed ")).toBe("the_harbour_deed");
    // NFC: a decomposed é folds to the composed one.
    expect(topicKey("café")).toBe("café");
    // Non-Latin survives as itself (no slug, no transliteration).
    expect(topicKey("港湾 の 証書")).toBe("港湾_の_証書");
    expect(topicKey("صك الميناء")).toBe("صك_الميناء");
    expect(topicKey("")).toBe("");
    expect(propositionKeyOf("The harbour deed is forged")).toBe("the_harbour_deed_is_forged");
    expect(buildDimensionKey(dimensionEntry("stance")!, "The Harbour Deed")).toBe("stance:the_harbour_deed");
  });

  it("caps a key without tearing a surrogate pair", () => {
    expect(capKey("abc", 5)).toBe("abc");
    expect(capKey("abcdef", 3)).toBe("abc");
    // 😀 is two UTF-16 units; a cap of 3 after "ab" cannot fit it.
    expect(capKey("ab😀cd", 3)).toBe("ab");
    expect(capKey("ab😀cd", 4)).toBe("ab😀");
    expect(propositionKeyOf("x".repeat(400), 300)).toHaveLength(300);
  });

  it("keeps the C1 coarse keys readable: three are proper entries, bare `appearance` is legacy-only", () => {
    expect(LEGACY_DIMENSION_KEYS).toEqual(["appearance", "trait", "location", "voice"]);
    for (const key of LEGACY_DIMENSION_KEYS) expect(isLegacyDimensionKey(key)).toBe(true);
    expect(isVocabularyDimension("trait")).toBe(true);
    expect(isVocabularyDimension("location")).toBe(true);
    expect(isVocabularyDimension("voice")).toBe(true);
    expect(isVocabularyDimension("appearance")).toBe(false);
  });
});
