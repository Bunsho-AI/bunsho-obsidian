import { describe, expect, it } from "vitest";
import { DESKTOP_ID_PATTERN, ENGINE_ID_PATTERN, isDesktopMintedId, mintEntityId, mintKnowledgeId, mintStateId } from "@/helpers/canon/ids";

const MINTERS = [["ent", mintEntityId], ["st", mintStateId], ["kn", mintKnowledgeId]] as const;

describe("canon id minting (the desktop's ids.test.ts)", () => {
  it.each(MINTERS)("%s ids carry the family prefix and a lowercase hyphenated UUIDv4", (prefix, mint) => {
    for (let i = 0; i < 200; i++) {
      const id = mint();
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      expect(id).toMatch(DESKTOP_ID_PATTERN);
      expect(id).toBe(id.toLowerCase());
      expect(id).toContain("-");
    }
  });
  it("entity ids are 40 characters", () => { expect(mintEntityId()).toHaveLength(40); });
  it("no minted id can ever match the engine's id pattern", () => {
    for (const [, mint] of MINTERS) for (let i = 0; i < 500; i++) { const id = mint(); expect(ENGINE_ID_PATTERN.test(id)).toBe(false); expect(isDesktopMintedId(id)).toBe(true); }
  });
  it("the engine's own ids are not ours", () => {
    for (const engineId of ["ent_mira_vale", "ent_mira_vale_2", "st_1", "kn_ent_x_3", "ent_entity", "ent_v3_abc"]) { expect(ENGINE_ID_PATTERN.test(engineId)).toBe(true); expect(isDesktopMintedId(engineId)).toBe(false); }
  });
  it("is collision-free across a large batch", () => { expect(new Set(Array.from({ length: 5000 }, mintEntityId)).size).toBe(5000); });
});
