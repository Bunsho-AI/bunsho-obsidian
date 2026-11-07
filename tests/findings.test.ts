import { describe, expect, it } from "vitest";
import { cardEvidence, displayOrder, keepSettledFindings, nextOpenIssue, railEvidence, resolverContext, resolutionOf } from "@/helpers/findings";
import { PANEL_TABS } from "@/helpers/panelTabs";
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

describe("the panel's tabs", () => {
  it("keep the desktop's names, icons and order", () => {
    expect(PANEL_TABS).toEqual([
      { id: "world", label: "World", icon: "globe" },
      { id: "continuity", label: "Continuity", icon: "check-circle-2" },
    ]);
  });
});

describe("order and carried decisions", () => {
  it("next issue follows the panel's order, errors first", () => {
    const open = displayOrder([issue({ issue_id: "w1", severity: "warning" }), issue({ issue_id: "e" }), issue({ issue_id: "w2", severity: "warning" })]);
    expect(open.map((i) => i.issue_id)).toEqual(["e", "w1", "w2"]);
    expect(nextOpenIssue(open, "e")?.issue_id).toBe("w1");
  });

  const finding = (id: string, quotes: string[], subject = "Mira", pages = ["p1", "p2"]) => issue({
    issue_id: id, context_json: JSON.stringify({ findingType: "contradiction", subject }),
    citations: quotes.map((quote, i) => cite(pages[i] ?? "p1", "prior_fact", quote)),
  });

  it("a settled finding keeps its id when the writer rewords one side", () => {
    const before = finding("old", ["Her eyes were green.", "Her eyes were brown."]);
    const after = finding("new", ["Her eyes were green.", "By then her eyes were brown and tired."]);
    expect(keepSettledFindings([after], [before], new Set(["old"]))[0].issue_id).toBe("old");
  });

  it("a new problem never takes an old decision", () => {
    const before = finding("old", ["Her eyes were green.", "Her eyes were brown."]);
    expect(keepSettledFindings([finding("n1", ["He sold the boat.", "He kept the boat."])], [before], new Set(["old"]))[0].issue_id).toBe("n1");
    expect(keepSettledFindings([finding("n2", ["Her eyes were green.", "x"], "Juna")], [before], new Set(["old"]))[0].issue_id).toBe("n2");
    expect(keepSettledFindings([finding("n3", ["Her eyes were green.", "x"], "Mira", ["p1", "p9"])], [before], new Set(["old"]))[0].issue_id).toBe("n3");
  });

  it("does nothing when the finding came back unchanged, was never settled, or the match is ambiguous", () => {
    const before = finding("old", ["Her eyes were green.", "Her eyes were brown."]);
    expect(keepSettledFindings([before], [before], new Set(["old"]))[0].issue_id).toBe("old");
    expect(keepSettledFindings([finding("n", ["Her eyes were green.", "y"])], [before], new Set())[0].issue_id).toBe("n");
    const twins = [finding("a", ["Her eyes were green.", "y"]), finding("b", ["Her eyes were green.", "z"])];
    expect(keepSettledFindings(twins, [before], new Set(["old"])).map((i) => i.issue_id)).toEqual(["a", "b"]);
  });
});
