/** The desktop's adopt and prune cases (pipelineV3Issues.test.ts), then the merge rules around them. */
import { describe, expect, it } from "vitest";
import type { EngineIssue } from "@/lib/contract/engine.types";
import { adoptPriorFindings, clusterOf, itemsPending, mergeReview, pagesPending, pipelineV3PruneSets, type MergeInput, type StoredClusterLike } from "@/helpers/reviewMerge";
import type { PageMeta } from "@/helpers/sources";

const ref = (pageId: string, rev: string) => ({ snapshotId: "s".repeat(64), pageId, rev, start: 0, end: 4 });
const cluster = (clusterKey: string, evidence: Array<[string, string, string]>, type = "trait_contradiction"): StoredClusterLike => ({
  clusterKey, type, evidence: evidence.map(([pageId, rev, quotedText]) => ({ pageId, sourceRef: ref(pageId, rev), quotedText })),
  context: { pageIds: [...new Set(evidence.map(([pageId]) => pageId))] } });

describe("pipelineV3PruneSets", () => {
  const current = new Map([["a", { rev: "a2", text: "Mara's green eyes shone. She laughed." }], ["b", { rev: "b1", text: "Mara had grey eyes." }]]);

  it("retires a cross-chapter finding whose quote is gone from a re-checked chapter", () => {
    const sets = pipelineV3PruneSets([cluster("fixed", [["a", "a1", "Mara's blue eyes shone."], ["b", "b1", "Mara had grey eyes."]])], new Set(), new Set(["a"]), current);
    expect(sets.stale).toEqual(["fixed"]);
  });

  it("keeps a finding whose quote is still there after an edit elsewhere in the chapter (new offsets, new key)", () => {
    const sets = pipelineV3PruneSets([cluster("moved", [["a", "a1", "She laughed."], ["b", "b1", "Mara had grey eyes."]])], new Set(), new Set(["a"]), current);
    expect(sets.stale).toEqual([]);
  });

  it("retires a finding citing a chapter that no longer exists", () => {
    expect(pipelineV3PruneSets([cluster("gone", [["b", "b1", "Mara had grey eyes."], ["deleted", "d1", "x"]])], new Set(), new Set(["a"]), current).stale).toEqual(["gone"]);
  });

  it("never retires what the sweep reproduced", () => {
    const sets = pipelineV3PruneSets([cluster("again", [["a", "a1", "gone"]])], new Set(["again"]), new Set(["a"]), current);
    expect(sets.stale).toEqual([]);
    expect(sets.keep).toEqual(["again"]);
  });

  it("keeps a finding whose quote spans a paragraph break", () => {
    const twoParagraphs = new Map([["a", { rev: "a2", text: "Mara's green eyes shone.\nShe laughed." }]]);
    expect(pipelineV3PruneSets([cluster("spans", [["a", "a1", "shone. She laughed."]])], new Set(), new Set(["a"]), twoParagraphs).stale).toEqual([]);
  });

  it("leaves evidence on chapters not checked in this sweep alone", () => {
    expect(pipelineV3PruneSets([cluster("elsewhere", [["b", "b0", "gone"]])], new Set(), new Set(["a"]), current).stale).toEqual([]);
  });
});

describe("adoptPriorFindings", () => {
  // A cross-chapter finding: side one on p1 (unchanged by the edit), side two on p3.
  const issue = (key: string, pages: string[], context: Record<string, unknown> = {}, quotes: string[] = ["Mara had grey eyes.", "Mara's blue eyes shone."], type = "trait_contradiction"): EngineIssue => ({
    issue_id: key, type, severity: "error", message: "m", related_node_ids: [], issue_confidence: 0.9,
    context_json: JSON.stringify({ origin: "pipeline_v3", clusterKey: key, findingType: "contradiction", subject: "Mara", ...context }),
    citations: pages.map((pageId, i) => ({ page_id: pageId, page_order: i, quoted_text: quotes[i] ?? "q", evidence_role: i ? "current_conflict" : "prior_fact", location_label: "" })) });
  const stored = (key: string, pages: string[], context: Record<string, unknown> = {}, type = "trait_contradiction",
    quotes: string[] = ["Mara had grey eyes.", "Her blue eyes shone at dusk."], status = "open"): StoredClusterLike => ({
    clusterKey: key, type, status, evidence: pages.map((pageId, i) => ({ pageId, quotedText: quotes[i] })),
    context: { pageIds: pages, rawContext: { origin: "pipeline_v3", clusterKey: key, findingType: "contradiction", subject: "Mara", ...context } } });
  const keys = (issues: EngineIssue[]) => issues.map((i) => [i.issue_id, (JSON.parse(i.context_json) as { clusterKey: string }).clusterKey]);

  it("gives a problem found again after an edit the key of its stored card (the unedited side's quote is shared)", () => {
    expect(keys(adoptPriorFindings([issue("new", ["p1", "p3"])], [stored("old", ["p1", "p3"])]))).toEqual([["old", "old"]]);
  });

  it("treats a plot hole and a contradiction between the same chapters as one problem", () => {
    expect(keys(adoptPriorFindings([issue("new", ["p1", "p3"], { findingType: "plot_hole" })], [stored("old", ["p1", "p3"])]))).toEqual([["old", "old"]]);
  });

  it("never takes over a card for a different problem about the same individual (review H1)", () => {
    // Stored: Mara's eye colour, ch1 vs ch3. Found now: Mara's age between the same chapters, sharing no quote.
    const age = issue("age", ["p1", "p3"], {}, ["Mara was nineteen that spring.", "At thirty, Mara still rowed."]);
    expect(keys(adoptPriorFindings([age], [stored("eyes", ["p1", "p3"])]))).toEqual([["age", "age"]]);
  });

  it("adopts without a shared quote only an open card whose own text was edited", () => {
    const pov = (key: string, quote: string) => issue(key, ["p3"], { findingType: "pov_drift" }, [quote]);
    const storedPov = (status = "open") => stored("old", ["p3"], { findingType: "pov_drift" }, "pov_head_hop", ["Estella privately resolved to burn it."], status);
    const current = new Map([["p3", "Estella, he guessed, meant to burn it."]]);
    expect(keys(adoptPriorFindings([pov("new", "Estella, he guessed, meant to burn it.")], [storedPov()], current))).toEqual([["old", "old"]]);
    // Its text is still there: nothing proves the new finding is the same problem.
    const unchanged = new Map([["p3", "Estella privately resolved to burn it."]]);
    expect(keys(adoptPriorFindings([pov("new", "Estella privately resolved to burn it all.")], [storedPov()], unchanged))).toEqual([["new", "new"]]);
    // A dismissed card is never taken over without a shared quote (a new problem must not inherit a dismissal).
    expect(keys(adoptPriorFindings([pov("new", "Estella, he guessed, meant to burn it.")], [storedPov("dismissed")], current))).toEqual([["new", "new"]]);
  });

  it("takes over a dismissed card only on a shared quote", () => {
    expect(keys(adoptPriorFindings([issue("new", ["p1", "p3"])], [stored("old", ["p1", "p3"], {}, "trait_contradiction", undefined, "dismissed")]))).toEqual([["old", "old"]]);
  });

  it("leaves a finding found exactly as stored alone, and never gives its card to another", () => {
    const out = adoptPriorFindings([issue("old", ["p1", "p3"]), issue("new", ["p1", "p3"])], [stored("old", ["p1", "p3"])]);
    expect(keys(out)).toEqual([["old", "old"], ["new", "new"]]);
  });

  it("matches by the individual when two problems share the chapters, and adopts nothing it cannot tell apart", () => {
    const olds = [stored("old-mara", ["p1", "p3"]), stored("old-joe", ["p1", "p3"], { subject: "Joe" })];
    expect(keys(adoptPriorFindings([issue("n1", ["p1", "p3"], { subject: "joe" }), issue("n2", ["p1", "p3"])], olds))).toEqual([["old-joe", "old-joe"], ["old-mara", "old-mara"]]);
    expect(keys(adoptPriorFindings([issue("n1", ["p1", "p3"]), issue("n2", ["p1", "p3"])], [stored("o1", ["p1", "p3"]), stored("o2", ["p1", "p3"])]))).toEqual([["n1", "n1"], ["n2", "n2"]]);
  });

  it("tells two problems about the same individual apart by the type shown, then by a quote they share", () => {
    // Engine identities changed once (2026-09-27): the same two Mira findings came back under new keys.
    expect(keys(adoptPriorFindings([issue("n-state", ["p1", "p3"], {}, undefined, "object_state_violation"), issue("n-trait", ["p1", "p3"])],
      [stored("o-trait", ["p1", "p3"]), stored("o-state", ["p1", "p3"], {}, "object_state_violation")]))).toEqual([["o-state", "o-state"], ["o-trait", "o-trait"]]);
    expect(keys(adoptPriorFindings([issue("n1", ["p1", "p3"], {}, ["She could not swim.", "x"]), issue("n2", ["p1", "p3"], {}, ["Her grey eyes.", "y"])],
      [stored("o-eyes", ["p1", "p3"], {}, "trait_contradiction", ["Her grey eyes.", "z"]), stored("o-swim", ["p1", "p3"], {}, "trait_contradiction", ["She could not swim.", "w"])])))
      .toEqual([["o-swim", "o-swim"], ["o-eyes", "o-eyes"]]);
  });

  it("never gives one individual's card to a finding about another", () => {
    const juna = issue("n-juna", ["p1", "p3"], { subject: "Juna Redlow" });
    expect(keys(adoptPriorFindings([juna], [stored("o-mara", ["p1", "p3"])]))).toEqual([["n-juna", "n-juna"]]);
    expect(keys(adoptPriorFindings([juna], [stored("o-trait", ["p1", "p3"]), stored("o-state", ["p1", "p3"], {}, "object_state_violation")]))).toEqual([["n-juna", "n-juna"]]);
    // The cast may name the same individual more fully another time; "Ed" is not "Fred".
    expect(keys(adoptPriorFindings([issue("n", ["p1", "p3"], { subject: "Mara Vell" })], [stored("o", ["p1", "p3"])]))).toEqual([["o", "o"]]);
    expect(keys(adoptPriorFindings([issue("n", ["p1", "p3"], { subject: "Fred" })], [stored("o", ["p1", "p3"], { subject: "Ed" })]))).toEqual([["n", "n"]]);
  });

  it("never crosses chapters, pins or pipelines", () => {
    expect(keys(adoptPriorFindings([issue("new", ["p1", "p2"])], [stored("old", ["p1", "p3"])]))).toEqual([["new", "new"]]);
    expect(keys(adoptPriorFindings([issue("new", ["p3"], { findingType: "canon_conflict", pinnedStateId: "st_hair" }, ["Mara had grey eyes."])],
      [stored("old", ["p3"], { findingType: "canon_conflict", pinnedStateId: "st_eyes" }, "canon_conflict", ["Mara had grey eyes."])]))).toEqual([["new", "new"]]);
    const v2: StoredClusterLike = { clusterKey: "v2", type: "trait_contradiction", evidence: [{ pageId: "p1", quotedText: "Mara had grey eyes." }, { pageId: "p3" }],
      context: { pageIds: ["p1", "p3"], rawContext: {} } };
    expect(keys(adoptPriorFindings([issue("new", ["p1", "p3"])], [v2]))).toEqual([["new", "new"]]);
  });

  it("treats two cuts of one long section as the same chapters, so a moved cut cannot read as a fix", () => {
    const sourceOf = (pageId: string) => pageId.split("~")[0];
    const moved = issue("new", ["book~a", "book~z"]);
    expect(keys(adoptPriorFindings([moved], [stored("old", ["book~a", "book~b"])], new Map(), sourceOf))).toEqual([["old", "old"]]);
    expect(keys(adoptPriorFindings([moved], [stored("old", ["book~a", "book~b"])]))).toEqual([["new", "new"]]);
  });
});

const page = (pageId: string, order: number, rev: string, sourceId = pageId): PageMeta => ({ pageId, order, rev, sourceId, label: pageId, noteId: sourceId, path: `${sourceId}.md`, noteOffset: 0 });
const POLICY = "p".repeat(64);

describe("the ledger's pending rule", () => {
  const ledger = { a: { rev: "a1", order: 0, policyId: POLICY, checkedAt: 1 }, b: { rev: "b1", order: 1, policyId: POLICY, checkedAt: 1 } };
  const now = (extra: PageMeta[] = []) => [page("a", 0, "a1"), page("b", 1, "b1"), ...extra];

  it("holds a page checked only at its revision, its place and the current policy", () => {
    expect(pagesPending(now(), ledger, POLICY)).toEqual([]);
    expect(pagesPending([page("a", 0, "a2"), page("b", 1, "b1")], ledger, POLICY).map((p) => p.pageId)).toEqual(["a"]);
    expect(pagesPending([page("b", 0, "b1"), page("a", 1, "a1")], ledger, POLICY).map((p) => p.pageId)).toEqual(["b", "a"]);
    expect(pagesPending(now(), ledger, "q".repeat(64))).toHaveLength(2);
    expect(pagesPending(now([page("c", 2, "c1")]), ledger, POLICY).map((p) => p.pageId)).toEqual(["c"]);
  });

  it("reports by plan item, never by unit: one changed part makes its whole item pending", () => {
    const parts = [page("book~1", 0, "1", "book"), page("book~2", 1, "2", "book"), page("c", 2, "c1")];
    const checked = { "book~1": { rev: "1", order: 0, policyId: POLICY, checkedAt: 1 }, "book~2": { rev: "2x", order: 1, policyId: POLICY, checkedAt: 1 }, c: { rev: "c1", order: 2, policyId: POLICY, checkedAt: 1 } };
    expect(itemsPending(parts, checked, POLICY)).toEqual(["book"]);
  });
});

describe("mergeReview", () => {
  const SNAP = "s".repeat(64);
  const issue = (id: string, citations: Array<[string, string, string, string?]>, context: Record<string, unknown> = {}): EngineIssue => ({
    issue_id: id, type: "trait_contradiction", severity: "error", message: id, related_node_ids: [], issue_confidence: 0.9,
    context_json: JSON.stringify({ origin: "pipeline_v3", clusterKey: id, findingType: "contradiction", subject: "Mira", ...context }),
    citations: citations.map(([pageId, rev, quote, role], i) => ({ page_id: pageId, page_order: 0, quoted_text: quote, location_label: "", evidence_role: role ?? (i ? "current_conflict" : "prior_fact"),
      source_ref: { snapshotId: SNAP, pageId, rev, start: 0, end: quote.length } })) });
  const prior = (issues: EngineIssue[], ledger: Record<string, { rev: string; order: number; policyId: string; checkedAt: number }>, pages = [page("a", 0, "a1"), page("b", 1, "b1"), page("c", 2, "c1")]) => ({
    checkedAt: 1, snapshotId: "o".repeat(64), source: { kind: "folder" as const, path: "Book" }, pages, issues, ledger,
    coverage: { sources: pages.map((p) => ({ id: p.sourceId, label: p.label })), unreadSources: [], excluded: 0 }, refundedCredits: 0, droppedFindings: 0 });
  const LEDGER = { a: { rev: "a1", order: 0, policyId: POLICY, checkedAt: 1 }, b: { rev: "b1", order: 1, policyId: POLICY, checkedAt: 1 }, c: { rev: "c1", order: 2, policyId: POLICY, checkedAt: 1 } };
  const input = (over: Partial<MergeInput>): MergeInput => ({
    prior: null, scope: "chapters", reason: "sweep", checked: ["b"], edited: new Set(), pageSetChanged: false, alone: false, policyId: POLICY, checkedAt: 2,
    statusOf: () => "open", items: [{ id: "a", label: "a", included: true }, { id: "b", label: "b", included: true }, { id: "c", label: "c", included: true }],
    run: { snapshotId: SNAP, source: { kind: "folder", path: "Book" }, pages: [page("a", 0, "a1"), page("b", 1, "b2"), page("c", 2, "c1")], issues: [], unreadPages: [], capped: false, refundedCredits: 0, droppedFindings: 0 },
    texts: new Map([["a", { rev: "a1", text: "Her eyes were green." }], ["b", { rev: "b2", text: "Her eyes were brown today." }], ["c", { rev: "c1", text: "Nothing." }]]),
    ...over });

  it("a new id for an edited sentence maps to the old card, and does not read as gone", () => {
    const old = issue("old", [["a", "a1", "Her eyes were green."], ["b", "b1", "Her eyes were brown."]]);
    const again = issue("new", [["a", "a1", "Her eyes were green."], ["b", "b2", "Her eyes were brown today."]]);
    const merged = mergeReview(input({ prior: prior([old], LEDGER), reason: "check", run: { ...input({}).run, issues: [again] } }));
    expect(merged.review.issues.map((i) => i.issue_id)).toEqual(["old"]);
    expect(merged.survivors.has("old")).toBe(true);
    expect(merged.review.issues[0].citations[1].quoted_text).toBe("Her eyes were brown today.");
  });

  it("marks a checked page from the revision sent and leaves the others alone", () => {
    const merged = mergeReview(input({ prior: prior([], LEDGER) }));
    expect(merged.review.ledger.b).toEqual({ rev: "b2", order: 1, policyId: POLICY, checkedAt: 2 });
    expect(merged.review.ledger.a.checkedAt).toBe(1);
    expect(merged.done).toEqual(["b"]);
  });

  it("does not mark a chapter edited during the run or one the engine could not read", () => {
    const edited = mergeReview(input({ prior: prior([], LEDGER), edited: new Set(["b"]) }));
    expect(edited.review.ledger.b.rev).toBe("b1");
    expect(edited.failed).toEqual(["b"]);
    expect(edited.message).toMatch(/edited during the review/u);
    const unread = mergeReview(input({ prior: prior([], LEDGER), run: { ...input({}).run, unreadPages: ["b"], refundedCredits: 36 } }));
    expect(unread.review.ledger.b.rev).toBe("b1");
    expect(unread.message).toBe("One chapter could not be read this time; the rest of the book was checked. Its 36 credits were refunded. Review it again.");
  });

  it("drops findings citing a chapter edited during the run, and keeps the rest", () => {
    const merged = mergeReview(input({ prior: prior([], LEDGER), edited: new Set(["a"]), run: { ...input({}).run, issues: [
      issue("x", [["a", "a1", "Her eyes were green."], ["b", "b2", "Her eyes were brown today."]]), issue("y", [["c", "c1", "Nothing."], ["b", "b2", "Her eyes were brown today."]]),
    ] } }));
    expect(merged.review.issues.map((i) => i.issue_id)).toEqual(["y"]);
  });

  it("prunes on a sweep: not reproduced with every page checked, quote gone, or chapter gone", () => {
    const checkedOnly = issue("checked-only", [["b", "b1", "Her eyes were brown today."]]);
    const quoteGone = issue("quote-gone", [["a", "a1", "Her eyes were green."], ["b", "b1", "Her eyes were hazel."]]);
    const chapterGone = issue("chapter-gone", [["a", "a1", "Her eyes were green."], ["deleted", "d1", "x"]]);
    const elsewhere = issue("elsewhere", [["a", "a1", "Her eyes were green."], ["b", "b1", "Her eyes were brown today."]]);
    const merged = mergeReview(input({ prior: prior([checkedOnly, quoteGone, chapterGone, elsewhere], LEDGER) }));
    expect(merged.review.issues.map((i) => i.issue_id)).toEqual(["elsewhere"]);
    expect(merged.pruned.sort()).toEqual(["chapter-gone", "checked-only", "quote-gone"]);
  });

  it("never prunes on a chapter check, a stale run, a capped run or when nothing was marked", () => {
    const gone = issue("gone", [["b", "b1", "Her eyes were hazel."]]);
    const issues = (over: Partial<MergeInput>) => mergeReview(input({ prior: prior([gone], LEDGER), ...over })).review.issues.map((i) => i.issue_id);
    expect(issues({ reason: "check" })).toEqual(["gone"]);
    expect(issues({ pageSetChanged: true })).toEqual(["gone"]);
    expect(issues({ run: { ...input({}).run, capped: true } })).toEqual(["gone"]);
    expect(issues({ alone: true })).toEqual(["gone"]);
    expect(issues({ edited: new Set(["b"]) })).toEqual(["gone"]);
  });

  it("reopens only a card closed as fixed, and keeps a dismissal or a decision", () => {
    const old = issue("old", [["a", "a1", "Her eyes were green."], ["b", "b1", "Her eyes were brown."]]);
    const again = issue("old", [["a", "a1", "Her eyes were green."], ["b", "b2", "Her eyes were brown today."]]);
    const merge = (status: "closed_auto" | "dismissed") => mergeReview(input({ prior: prior([old], LEDGER), statusOf: () => status, reason: "check", run: { ...input({}).run, issues: [again] } }));
    expect(merge("closed_auto").reopened).toEqual(["old"]);
    expect(merge("dismissed").reopened).toEqual([]);
  });

  it("says a chapter check could not compare, marks nothing and keeps its findings, when the book was never read", () => {
    const found = issue("n", [["b", "b2", "Her eyes were brown today."]]);
    const merged = mergeReview(input({ alone: true, prior: prior([], LEDGER), reason: "check", run: { ...input({}).run, issues: [found] } }));
    expect(merged.done).toEqual([]);
    expect(merged.review.issues).toHaveLength(1);
    expect(merged.message).toBe("This chapter was checked, but not all of the rest of the book has been read yet, so contradictions with other chapters could not all be looked for. Its findings are saved; run a full review to check it against the whole book.");
  });

  it("a full review starts a new ledger; a chapter check keeps the old entries", () => {
    const full = mergeReview(input({ scope: "full", prior: prior([], { ...LEDGER, old: { rev: "x", order: 9, policyId: POLICY, checkedAt: 1 } }), checked: ["a", "b", "c"] }));
    expect(Object.keys(full.review.ledger).sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps a page a surviving finding still cites, so its passage can still be opened", () => {
    const old = issue("old", [["gone", "g1", "Her eyes were green."], ["a", "a1", "Her eyes were green."]]);
    const pages = [page("gone", 3, "g1"), page("a", 0, "a1")];
    const merged = mergeReview(input({ reason: "check", prior: prior([old], LEDGER, pages) }));
    expect(merged.review.pages.map((p) => p.pageId)).toContain("gone");
  });

  it("states what has been read in writer's terms", () => {
    const merged = mergeReview(input({ prior: prior([], { a: LEDGER.a }), items: [{ id: "a", label: "a", included: true }, { id: "b", label: "b", included: true }, { id: "c", label: "c", included: true }, { id: "x", label: "x", included: false }] }));
    expect(merged.review.coverage).toEqual({ sources: [{ id: "a", label: "a" }, { id: "b", label: "b" }, { id: "c", label: "c" }], unreadSources: ["c"], excluded: 1 });
  });

  it("clusterOf sees a plugin finding as the desktop's stored card", () => {
    const c = clusterOf(issue("k", [["a", "a1", "q"], ["b", "b1", "r"]]), "dismissed");
    expect(c).toMatchObject({ clusterKey: "k", status: "dismissed", context: { pageIds: ["a", "b"], rawContext: { origin: "pipeline_v3" } } });
    expect(c.evidence[1]).toMatchObject({ pageId: "b", quotedText: "r" });
  });
});
