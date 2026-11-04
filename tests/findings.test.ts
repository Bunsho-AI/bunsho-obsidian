import { describe, expect, it } from "vitest";
import { cardEvidence, nextOpenIssue, railEvidence, resolverContext, resolutionOf } from "@/helpers/findings";
import type { EngineIssue, EngineIssueCitation } from "@/lib/contract/engine.types";

const cite = (page: string, role: string, quote: string): EngineIssueCitation =>
  ({ page_id: page, page_order: 0, quoted_text: quote, evidence_role: role, location_label: page }) as unknown as EngineIssueCitation;
const issue = (over: Partial<EngineIssue> = {}): EngineIssue =>
  ({ issue_id: "a", type: "t", severity: "error", message: "Her eyes change.", citations: [], ...over }) as unknown as EngineIssue;

describe("the card, as the desktop's", () => {
  it("shows the current conflict when the engine marks one", () => {
    const green = cite("p1", "prior_fact", "green");
    const brown = cite("p2", "current_conflict", "brown");
    expect(cardEvidence(issue({ citations: [green, brown] }))).toBe(brown);
  });

  it("falls back to the first citation, and to nothing", () => {
    const first = cite("p1", "prior_fact", "green");
    expect(cardEvidence(issue({ citations: [first, cite("p2", "prior_fact", "x")] }))).toBe(first);
    expect(cardEvidence(issue())).toBeNull();
  });
});

describe("the Resolve screen", () => {
  it("lists the two sides in the engine's order, without supporting context", () => {
    const green = cite("p1", "prior_fact", "green");
    const brown = cite("p2", "current_conflict", "brown");
    expect(railEvidence(issue({ citations: [green, cite("p3", "supporting_context", "aside"), brown] }))).toEqual([green, brown]);
  });

  it("does not repeat the finding as its own context", () => {
    const message = "Her eyes change.";
    expect(resolverContext(issue({ message, evidence_summary: ` her eyes  CHANGE. ` })).summary).toBeNull();
    expect(resolverContext(issue({ message, evidence_summary: "Nothing explains it." })).summary).toBe("Nothing explains it.");
  });

  it("reads the note and subject, and survives broken context", () => {
    expect(resolverContext(issue({ context_json: JSON.stringify({ suggestion: "Pick one.", subject: "Mira" }) }))).toEqual({ note: "Pick one.", subject: "Mira", summary: null });
    expect(resolverContext(issue({ context_json: "{not json" }))).toEqual({ note: null, subject: null, summary: null });
    expect(resolverContext(issue({ context_json: JSON.stringify({ suggestion: 3, subject: ["x"] }) }))).toEqual({ note: null, subject: null, summary: null });
  });

  it("next issue moves on, wraps, and is absent when this is the last one open", () => {
    const open = [issue({ issue_id: "a" }), issue({ issue_id: "b" }), issue({ issue_id: "c" })];
    expect(nextOpenIssue(open, "a")?.issue_id).toBe("b");
    expect(nextOpenIssue(open, "c")?.issue_id).toBe("a");
    expect(nextOpenIssue([open[0]], "a")).toBeNull();
    expect(nextOpenIssue(open, "gone")?.issue_id).toBe("a");
  });
});

describe("what became of a finding", () => {
  it("uses the desktop's status words, and a dismissal wins", () => {
    expect(resolutionOf("a", new Set(["a"]), new Set())).toBe("dismissed");
    expect(resolutionOf("a", new Set(), new Set(["a"]))).toBe("closed manual");
    expect(resolutionOf("a", new Set(["a"]), new Set(["a"]))).toBe("dismissed");
    expect(resolutionOf("a", new Set(), new Set())).toBeNull();
  });
});
