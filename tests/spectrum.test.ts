import { describe, expect, it } from "vitest";
import { displayIssueTitle, filterBySpectrum, getIssueSpectrum, orderSpectrumByCount, pickerGroups, SPECTRUM_CONFIG } from "@/helpers/spectrum";
import type { EngineIssue } from "@/lib/contract/engine.types";

const issue = (type: string, over: Partial<EngineIssue> = {}, context: Record<string, unknown> = {}): EngineIssue => ({
  issue_id: `${type}-${over.issue_id ?? ""}`, type, severity: "error", message: `about ${type}`, related_node_ids: [], context_json: JSON.stringify(context), citations: [], issue_confidence: 1, ...over });

describe("getIssueSpectrum", () => {
  it("reads the stored spectrum, then classifies by type, as the desktop does", () => {
    expect(getIssueSpectrum(issue("anything", {}, { spectrum: "voice" }))).toBe("voice");
    expect(getIssueSpectrum(issue("anything", {}, { spectrum: "not-a-kind" }))).toBe("factual");
    expect(getIssueSpectrum(issue("canon_conflict"))).toBe("factual");
    for (const [type, kind] of [["trait_contradiction", "factual"], ["name_drift", "factual"], ["timeline_conflict", "temporal"], ["age_mismatch", "temporal"], ["character_disappeared", "character_arc"],
      ["object_state_violation", "world"], ["geography", "world"], ["dialogue_register", "voice"], ["dropped_thread", "plot"], ["pov_head_hop", "factual"], ["", "factual"]] as const) {
      expect(getIssueSpectrum(issue(type))).toBe(kind);
    }
  });

  it("keeps the desktop's labels", () => {
    expect(Object.values(SPECTRUM_CONFIG).map((c) => c.label)).toEqual(["Factual", "Timeline", "Character Arcs", "World", "Voice", "Plot Threads"]);
  });
});

describe("chips", () => {
  const issues = [issue("trait_a"), issue("object_a"), issue("object_b"), issue("voice_a")];

  it("orders by count, hides zero, and keeps declared order on a tie", () => {
    expect(orderSpectrumByCount(issues)).toEqual([{ key: "world", count: 2 }, { key: "factual", count: 1 }, { key: "voice", count: 1 }]);
    expect(orderSpectrumByCount([])).toEqual([]);
  });

  it("filters, and no filter is everything", () => {
    expect(filterBySpectrum(issues, "world").map((i) => i.type)).toEqual(["object_a", "object_b"]);
    expect(filterBySpectrum(issues, null)).toHaveLength(4);
  });
});

describe("the jump picker", () => {
  const list = [issue("trait", { message: "Her eyes change" }), issue("object", { message: "The boat is sold twice", severity: "warning" }), issue("voice", { message: "He says \"eyes\" oddly", severity: "info" })];

  it("groups as the panel does, and filters on the title", () => {
    expect(pickerGroups(list, "").map((g) => [g.label, g.issues.length])).toEqual([["Open contradiction", 1], ["Worth a look", 2]]);
    expect(pickerGroups(list, "  EYES ").map((g) => [g.label, g.issues.map((i) => i.type)])).toEqual([["Open contradiction", ["trait"]], ["Worth a look", ["voice"]]]);
    expect(pickerGroups(list, "boat").map((g) => g.label)).toEqual(["Worth a look"]);
    expect(pickerGroups(list, "nothing here")).toEqual([]);
  });

  it("shows the title a finding is called by", () => {
    expect(displayIssueTitle(issue("t", { message: "m" }, { title: "From the engine" }))).toBe("From the engine");
    expect(displayIssueTitle(issue("t", { message: "m" }))).toBe("m");
    expect(displayIssueTitle(issue("trait_thing", { message: "" }))).toBe("trait thing");
    expect(displayIssueTitle(issue("", { message: "" }))).toBe("Untitled issue");
  });
});
