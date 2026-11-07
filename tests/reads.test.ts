import { describe, expect, it } from "vitest";
import { forgetCached, mergeCast, pruneReads, usableReads, worldReads, type KeptRead } from "@/helpers/reads";
import type { CastMember, ChapterRead } from "@/lib/contract/pipelineV3.types";

const POLICY = "b".repeat(64);
const read = (pageId: string, rev: string, order = 0, facts: ChapterRead["facts"] = []): ChapterRead => ({ pageId, order, rev, facts, cast: [], narration: { person: "third", povCharacter: "", tense: "past" }, povBreaks: [], droppedFacts: 0 });
const kept = (r: ChapterRead, policy: string | null = POLICY): KeptRead => ({ readPolicyId: policy, read: r });
const page = (pageId: string, rev: string, order = 0) => ({ pageId, rev, order });

describe("usableReads", () => {
  it("sends a read only under the current policy and at the page's current revision", () => {
    const reads = [kept(read("a", "a1")), kept(read("b", "b1")), kept(read("c", "c1"), "c".repeat(64)), kept(read("d", "d1"), null)];
    expect(usableReads(reads, POLICY, [page("a", "a1"), page("b", "b2"), page("c", "c1"), page("d", "d1")]).map((r) => r.pageId)).toEqual(["a"]);
  });

  it("gives a moved chapter its current order, everywhere the read carries one", () => {
    const fact = { id: "f", pageId: "a", order: 0, span: { start: 0, end: 1 }, quote: "x", paragraph: 0, subject: "s", attribute: "a", kind: "trait", statement: "s", question: "q", framing: "narration", speaker: null, textMarksUntrue: false } as ChapterRead["facts"][number];
    const [moved] = usableReads([kept(read("a", "a1", 0, [fact]))], POLICY, [page("a", "a1", 4)]);
    expect([moved.order, moved.facts[0].order]).toEqual([4, 4]);
  });
});

describe("worldReads", () => {
  it("shows each page as of when it was last checked, even after a newer read from a stopped run", () => {
    const reads = [kept(read("a", "a1")), kept(read("a", "a2"))];
    expect(worldReads(reads, { a: { rev: "a1" } }).map((r) => r.rev)).toEqual(["a1"]);
    expect(worldReads(reads, { a: { rev: "a2" } }).map((r) => r.rev)).toEqual(["a2"]);
    expect(worldReads(reads, {})).toEqual([]);
  });
});

describe("pruneReads", () => {
  it("keeps the checked revision and the latest of a page still in the book, and drops the rest", () => {
    const reads = [kept(read("a", "a0")), kept(read("a", "a1")), kept(read("a", "a2")), kept(read("gone", "g1")), kept(read("left", "l1"))];
    const out = pruneReads(reads, { a: { rev: "a1" }, left: { rev: "l1" } }, new Set(["a"]));
    expect(out.map((e) => `${e.read.pageId}:${e.read.rev}`)).toEqual(["a:a1", "a:a2", "left:l1"]);
  });
  it("keeps one read per page and revision, the newest", () => {
    const fresher = read("a", "a1", 3);
    expect(pruneReads([kept(read("a", "a1")), kept(fresher)], { a: { rev: "a1" } }, new Set(["a"])).map((e) => e.read.order)).toEqual([3]);
  });
});

describe("forgetCached", () => {
  it("stops every read being sent and keeps it for the World", () => {
    const out = forgetCached([kept(read("a", "a1"))]);
    expect(out[0].readPolicyId).toBeNull();
    expect(usableReads(out, POLICY, [page("a", "a1")])).toEqual([]);
    expect(worldReads(out, { a: { rev: "a1" } })).toHaveLength(1);
  });
});

describe("mergeCast", () => {
  const member = (id: string, name: string, extra: Partial<CastMember> = {}): CastMember => ({ id, name, kind: "person", names: [name], properNames: [name], aliases: [], chapters: [], roles: [], introduced: [], ...extra });

  it("a full review replaces the cast", () => {
    expect(mergeCast([member("r0", "Old")], [member("r0", "New")], "full").map((m) => m.name)).toEqual(["New"]);
  });

  it("a chapter review replaces same-name members and keeps the rest", () => {
    const out = mergeCast([member("r0", "Mira", { roles: ["old"] }), member("r1", "Joe")], [member("r0", "mira", { roles: ["new"] })], "chapters");
    expect(out.map((m) => [m.name, m.roles])).toEqual([["Joe", []], ["mira", ["new"]]]);
  });

  it("keeps ids unique: the engine numbers each run's cast from zero, and the World groups by id", () => {
    const out = mergeCast([member("r0", "Joe"), member("r1", "Ann")], [member("r0", "Mira"), member("r1", "Sol")], "chapters");
    expect(new Set(out.map((m) => m.id)).size).toBe(4);
    expect(out.filter((m) => m.name === "Mira")[0].id).toBe("r0");
  });
});
