import { describe, expect, it } from "vitest";
import { projectMarkdown } from "@/utils/markdown";

describe("projectMarkdown", () => {
  it("leaves plain prose untouched, offsets identity", () => {
    const p = projectMarkdown("Mira opened the door.\n\nThe room was cold.");
    expect(p.text).toBe("Mira opened the door.\n\nThe room was cold.");
    expect(p.toSource(0)).toBe(0);
    expect(p.toSource(24)).toBe(24);
  });

  it("drops frontmatter, comments, embeds and rules", () => {
    const raw = "---\ntitle: One\n---\nShe ran.\n%%note to self%%\n![[map.png]]\n***\nHe stayed.";
    expect(projectMarkdown(raw).text).toBe("She ran.\n\n\n\nHe stayed.");
  });

  it("shows link aliases or targets and keeps them mappable", () => {
    const raw = "Ask [[Mira Tennant|Mira]] or [[Juna]].";
    const p = projectMarkdown(raw);
    expect(p.text).toBe("Ask Mira or Juna.");
    expect(raw.slice(p.toSource(4), p.toSourceEnd(8))).toBe("Mira");
    expect(raw.slice(p.toSource(12), p.toSourceEnd(16))).toBe("Juna");
  });

  it("strips heading marks and emphasis marks but not intra-word underscores", () => {
    const p = projectMarkdown("# Chapter One\nShe *never* spoke of snake_case_names or **him**.");
    expect(p.text).toBe("Chapter One\nShe never spoke of snake_case_names or him.");
  });

  it("maps a quote back to the exact note slice", () => {
    const raw = "# One\nHer eyes were *green* that day.\n";
    const p = projectMarkdown(raw);
    const quote = "eyes were green";
    const start = p.text.indexOf(quote);
    expect(raw.slice(p.toSource(start), p.toSourceEnd(start + quote.length))).toBe("eyes were *green");
  });

  it("reads link anchors and markdown links as their visible words", () => {
    const raw = "See [[Harbour#^b1]], [[#The Fire]], [the map](maps/one.md) and ![pic](a.png).<!-- hidden -->";
    const p = projectMarkdown(raw);
    expect(p.text).toBe("See Harbour, The Fire, the map and .");
    const at = p.text.indexOf("the map");
    expect(raw.slice(p.toSource(at), p.toSourceEnd(at + 7))).toBe("the map");
    const fire = p.text.indexOf("The Fire");
    expect(raw.slice(p.toSource(fire), p.toSourceEnd(fire + 8))).toBe("The Fire");
  });

  it("works for any script (no word lists)", () => {
    const p = projectMarkdown("# 第一章\n彼女は**黙って**部屋を出た。");
    expect(p.text).toBe("第一章\n彼女は黙って部屋を出た。");
  });
});
