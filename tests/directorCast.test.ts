import { describe, expect, it } from "vitest";

import type { EngineEntity } from "@/helpers/director/world";
import { rankCast } from "@/helpers/director/cast";

function entity(
  name: string,
  pages: number,
  overrides: Partial<EngineEntity> = {},
): EngineEntity {
  return {
    entityId: `ent_${name.toLowerCase().replace(/\s+/g, "_")}`,
    canonicalName: name,
    type: "character",
    aliases: [{ text: name.split(" ")[0], kind: "given_name", grep: true }],
    status: "active",
    provenance: Array.from({ length: pages }, (_, i) => ({
      pageId: `p${i + 1}`,
      pageOrder: i,
      quote: `${name} was there.`,
    })),
    ...overrides,
  };
}

describe("rankCast", () => {
  it("splits main cast (3+ pages) from extras, sorted by appearances", () => {
    const cast = rankCast([
      entity("Herrick", 2),
      entity("Mira Vale", 8),
      entity("Selma", 5),
      entity("Pryce Boy", 1),
    ]);

    expect(cast.map((c) => `${c.name}:${c.tier}`)).toEqual([
      "Mira Vale:main",
      "Selma:main",
      "Herrick:extra",
      "Pryce Boy:extra",
    ]);
    expect(cast[0].appearances).toBe(8);
  });

  it("promotes the top few in a young manuscript where nobody has 3 pages", () => {
    const cast = rankCast([entity("Ana", 2), entity("Bo", 1), entity("Cy", 1), entity("Dee", 1)]);
    expect(cast.filter((c) => c.tier === "main")).toHaveLength(3);
    expect(cast[0].name).toBe("Ana");
  });

  it("excludes non-characters, inactive entities, and pronoun/duplicate aliases", () => {
    const compass = entity("Brass Compass", 5, { type: "object" });
    const ghost = entity("Old Maren", 4, { status: "merged" });
    const mira = entity("Mira Vale", 4, {
      aliases: [
        { text: "Mira", kind: "given_name", grep: true },
        { text: "she", kind: "pronoun", grep: false },
        { text: "Mira Vale", kind: "full_name", grep: true },
      ],
    });

    const cast = rankCast([compass, ghost, mira]);
    expect(cast).toHaveLength(1);
    expect(cast[0].aliases).toEqual(["Mira"]);
  });

  it("counts distinct pages, not raw provenance entries", () => {
    const doubled = entity("Jonah", 1);
    doubled.provenance = [
      { pageId: "p1", pageOrder: 0, quote: "a" },
      { pageId: "p1", pageOrder: 0, quote: "b" },
      { pageId: "p2", pageOrder: 1, quote: "c" },
    ];
    const cast = rankCast([doubled]);
    expect(cast[0].appearances).toBe(2);
  });

  it("lists a character added by hand (desktop-minted id, writer provenance, no pages) as first-class cast", () => {
    const byHand: EngineEntity = {
      entityId: "ent_9f3c2b1e-7a4d-4c2a-9b0e-2f6d8a1c5e44",
      canonicalName: "Tomas Reyes",
      type: "character",
      aliases: [],
      status: "active",
      provenance: [{ origin: "writer", declaredAt: "2026-08-22T00:00:00.000Z" }],
    };
    const extras = Array.from({ length: 9 }, (_, i) => entity(`Extra ${i + 1}`, 1));
    const cast = rankCast([entity("Mira Vale", 8), ...extras, byHand]);

    const tomas = cast.find((c) => c.name === "Tomas Reyes");
    expect(tomas).toMatchObject({ appearances: 0, tier: "extra", handCreated: true, aliases: [] });
    // Main cast first, then hand-written canon, then extracted extras — so a
    // capped @-mention list (8 rows) can never drop the writer's own character.
    expect(cast.map((c) => c.name).slice(0, 2)).toEqual(["Mira Vale", "Tomas Reyes"]);
    expect(cast.filter((c) => c.handCreated)).toHaveLength(1);
    expect(cast.find((c) => c.name === "Mira Vale")?.handCreated).toBe(false);
  });

  it("keeps hand-written canon in rank after it is extracted onto pages", () => {
    const promoted = entity("Tomas Reyes", 4, {
      entityId: "ent_9f3c2b1e-7a4d-4c2a-9b0e-2f6d8a1c5e44",
    });
    promoted.provenance.push({ origin: "writer", declaredAt: "2026-08-22T00:00:00.000Z" });
    const cast = rankCast([promoted, entity("Mira Vale", 8)]);
    expect(cast.map((c) => `${c.name}:${c.tier}`)).toEqual(["Mira Vale:main", "Tomas Reyes:main"]);
    expect(cast[1].appearances).toBe(4);
  });
});
