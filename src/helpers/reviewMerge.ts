/**
 * What a review's result does to the findings and the ledger. The engine merges nothing: a result holds only findings touching
 * the pages it checked. Pure ports of the desktop's adoptPriorFindings and pipelineV3PruneSets (pipelineV3Issues.ts) and of the
 * merge in runPipelineV3Review.ts, without the writer's pins, which come with Canon.
 *
 * A false "fixed" is the worst thing this file could cause. The engine keys a finding by the text of the paragraphs it cites, so
 * an edited sentence comes back with a new id; only adoption stops that reading as the old card having gone.
 */
import type { PageMeta, SourceChoice } from "@/helpers/sources";
import type { EngineIssue } from "@/lib/contract/engine.types";
import type { SourceReference } from "@/lib/contract/sourceReference";

/** What this review read, in the writer's terms: never reading units. */
export interface ReviewCoverage {
  /** Plan items sent, in order. */
  sources: { id: string; label: string }[];
  /** Plan items the engine could not fully read. */
  unreadSources: string[];
  /** Plan items the writer left out. */
  excluded: number;
}

/** A page was checked at this revision, in this place, under this policy. Recorded from what was sent, never from a re-read. */
export interface LedgerEntry { rev: string; order: number; policyId: string; checkedAt: number }
export type PageLedger = Record<string, LedgerEntry>;

export interface ReviewOutcome {
  checkedAt: number;
  snapshotId: string;
  /** What was picked when this ran: the panel shows a review only for its own source. */
  source: SourceChoice;
  /** The pages of the book at the last check, and any older page a finding still cites. */
  pages: PageMeta[];
  issues: EngineIssue[];
  coverage: ReviewCoverage;
  refundedCredits: number;
  droppedFindings: number;
  ledger: PageLedger;
}

/** The desktop's words for a card's state. A card the writer has not settled is open; closed_auto is "no longer detected". */
export type FindingStatus = "open" | "dismissed" | "closed_manual" | "closed_auto";

export interface StoredClusterLike {
  clusterKey: string;
  type: string;
  /** open / dismissed / closed_*; absent in tests of rules that do not read it. */
  status?: string;
  evidence: ReadonlyArray<{ pageId: string; sourceRef?: SourceReference; quotedText?: string }>;
  context: { pageIds: readonly string[]; rawContext?: Readonly<Record<string, unknown>> };
}

/** A chapter as this sweep reviewed it. */
export interface CurrentChapter { rev: string; text: string }

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function parsedContext(raw: string): Record<string, unknown> {
  try { const value: unknown = JSON.parse(raw); return record(value) ? value : {}; } catch { return {}; }
}

/** A plugin finding as the desktop's stored card. */
export function clusterOf(issue: EngineIssue, status: FindingStatus): StoredClusterLike {
  return {
    clusterKey: issue.issue_id, type: issue.type, status,
    evidence: issue.citations.map((citation) => ({ pageId: citation.page_id, sourceRef: citation.source_ref, quotedText: citation.quoted_text })),
    context: { pageIds: [...new Set(issue.citations.map((citation) => citation.page_id))], rawContext: parsedContext(issue.context_json) },
  };
}

/** What a finding is about beyond its wording: its kind (a plot hole and a contradiction are one), its pin, its chapters. */
function findingShape(context: Readonly<Record<string, unknown>>, type: string, pageIds: Iterable<string>): string {
  const kind = context.findingType === "plot_hole" ? "contradiction" : typeof context.findingType === "string" ? context.findingType : type;
  const pin = typeof context.pinnedStateId === "string" ? context.pinnedStateId : "";
  return `${kind}|${pin}|${[...new Set(pageIds)].sort().join(",")}`;
}
const subjectOf = (context: Readonly<Record<string, unknown>>): string =>
  typeof context.subject === "string" ? context.subject.normalize("NFC").trim().toLocaleLowerCase() : "";
const issueKey = (issue: EngineIssue, context: Readonly<Record<string, unknown>>): string =>
  typeof context.clusterKey === "string" && context.clusterKey ? context.clusterKey : issue.issue_id;

/** The words of a name, for comparing names the cast gives run to run (extracted structure, not prose). */
const nameWords = (name: string): Set<string> => new Set(name.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean));
/**
 * Two findings can be about the same individual unless both name one and neither name's words hold the other's. The cast names
 * an individual differently run to run ("Mira", "Mira Tennant"); "Ed" is not "Fred".
 */
function sameIndividual(a: string, b: string): boolean {
  if (!a || !b || a === b) return true;
  const [x, y] = [nameWords(a), nameWords(b)];
  const within = (small: Set<string>, big: Set<string>): boolean => small.size > 0 && [...small].every((w) => big.has(w));
  return within(x, y) || within(y, x);
}
const normalized = (text: string): string => text.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
/** Whether any quote of one finding holds, or is held by, a quote of the other. */
function sharesQuote(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => x && b.some((y) => y && (x.includes(y) || y.includes(x))));
}

/**
 * Keeps a finding's stored key when the writer edits its sentences and a review finds the same problem again.
 *
 * A new finding may take over a stored v3 finding of the same kind, pin and chapters, about a compatible individual, only on
 * positive evidence that it is the same problem: a quote they share (an edit leaves the other side of a cross-chapter finding as
 * it was), or, for an open card, proof it was edited: one of its quotes is gone from the chapters as reviewed (`current`). A
 * dismissed or closed card is taken over only on a shared quote, so a new problem is never saved under an old dismissal. Among
 * the eligible pairs a match must be unambiguous: one each, or each other's single best on the individual, then the type shown,
 * then a shared quote. Otherwise nothing is adopted.
 *
 * `chapterOf` is the one addition to the desktop's rule. A cut page's id moves with its cut, so "the same chapters" has to mean
 * the same plan items, or a moved cut would stop the finding being adopted and read as a fix.
 */
export function adoptPriorFindings(issues: readonly EngineIssue[], prior: readonly StoredClusterLike[],
  current: ReadonlyMap<string, string> = new Map(), chapterOf: (pageId: string) => string = (pageId) => pageId): EngineIssue[] {
  const stored = new Set(prior.map((cluster) => cluster.clusterKey));
  const fresh = issues.map((issue) => ({ issue, context: parsedContext(issue.context_json) }));
  const reproduced = new Set(fresh.map(({ issue, context }) => issueKey(issue, context)));
  const candidates = fresh.filter(({ issue, context }) => !stored.has(issueKey(issue, context)))
    .map((entry) => ({ ...entry, shape: findingShape(entry.context, entry.issue.type, entry.issue.citations.map((c) => chapterOf(c.page_id))), subject: subjectOf(entry.context),
      type: entry.issue.type, quotes: entry.issue.citations.map((c) => normalized(c.quoted_text)) }));
  const edited = (cluster: StoredClusterLike): boolean => cluster.evidence.some((e) => {
    const text = current.get(e.pageId);
    return text !== undefined && Boolean(e.quotedText?.trim()) && !normalized(text).includes(normalized(e.quotedText ?? ""));
  });
  const open = prior.filter((cluster) => cluster.context.rawContext?.origin === "pipeline_v3" && !reproduced.has(cluster.clusterKey))
    .map((cluster) => ({ cluster, shape: findingShape(cluster.context.rawContext ?? {}, cluster.type, cluster.evidence.map((e) => chapterOf(e.pageId))),
      subject: subjectOf(cluster.context.rawContext ?? {}), type: cluster.type, quotes: cluster.evidence.map((e) => normalized(e.quotedText ?? "")),
      live: cluster.status === undefined || cluster.status === "open" || cluster.status === "in_review", edited: edited(cluster) }));
  const eligible = (n: (typeof candidates)[number], o: (typeof open)[number]): boolean => sameIndividual(n.subject, o.subject)
    && (sharesQuote(n.quotes, o.quotes) || (o.live && o.edited));
  const adopted = new Map<EngineIssue, string>();
  for (const shape of new Set(candidates.map((c) => c.shape))) {
    const news = candidates.filter((c) => c.shape === shape);
    const olds = open.filter((o) => o.shape === shape);
    if (news.length === 1 && olds.length === 1) {
      if (eligible(news[0], olds[0])) adopted.set(news[0].issue, olds[0].cluster.clusterKey);
      continue;
    }
    // How alike a new and a stored finding are beyond their shape; a pair is adopted only as each other's single best.
    const score = (n: (typeof news)[number], o: (typeof olds)[number]): number => !eligible(n, o) ? 0
      : 1 + (n.subject && n.subject === o.subject ? 4 : 0) + (n.type === o.type ? 2 : 0) + (sharesQuote(n.quotes, o.quotes) ? 1 : 0);
    const bestOf = <A, B>(item: A, among: readonly B[], rate: (a: A, b: B) => number): B | undefined => {
      const scores = among.map((b) => rate(item, b));
      const top = Math.max(0, ...scores);
      return top > 0 && scores.filter((x) => x === top).length === 1 ? among[scores.indexOf(top)] : undefined;
    };
    for (const n of news) {
      const o = bestOf(n, olds, score);
      if (o && bestOf(o, news, (a, b) => score(b, a)) === n) adopted.set(n.issue, o.cluster.clusterKey);
    }
  }
  return fresh.map(({ issue, context }) => {
    const key = adopted.get(issue);
    return key ? { ...issue, issue_id: key, context_json: JSON.stringify({ ...context, clusterKey: key }) } : issue;
  });
}

const flattenParagraphs = (text: string): string => text.replace(/\n/gu, " ");

/**
 * What a sweep keeps and retires beyond retiring what was not re-derived when every cited chapter was checked: retire a finding
 * whose quote from a chapter checked in this sweep is no longer anywhere in that chapter's text, or that cites a chapter which no
 * longer exists. A finding whose quote is still there stays: a chapter check sees the rest of the book only through budgeted
 * passages, so not re-finding it proves nothing.
 */
export function pipelineV3PruneSets(clusters: readonly StoredClusterLike[], reproduced: ReadonlySet<string>,
  checked: ReadonlySet<string>, current: ReadonlyMap<string, CurrentChapter>): { keep: string[]; stale: string[] } {
  const keep = new Set(reproduced);
  const stale: string[] = [];
  for (const cluster of clusters) {
    if (keep.has(cluster.clusterKey)) continue;
    // A quote can span a paragraph break; the flattened text still holds it.
    const outdated = cluster.evidence.some((item) => {
      const chapter = current.get(item.pageId);
      return checked.has(item.pageId) && chapter !== undefined && item.sourceRef !== undefined && item.sourceRef.rev !== chapter.rev
        && Boolean(item.quotedText?.trim()) && !chapter.text.includes(item.quotedText ?? "") && !flattenParagraphs(chapter.text).includes(item.quotedText ?? "");
    });
    const orphaned = cluster.context.pageIds.some((pageId) => !current.has(pageId));
    if (outdated || orphaned) stale.push(cluster.clusterKey);
  }
  return { keep: [...keep], stale };
}

/** The pages not checked at their current revision, place and policy (desktop pipelineV3Coverage.ts). */
export function pagesPending<T extends Pick<PageMeta, "pageId" | "rev" | "order">>(pages: readonly T[], ledger: Readonly<PageLedger>, policyId: string): T[] {
  return pages.filter((page) => {
    const entry = ledger[page.pageId];
    return !(entry && entry.rev === page.rev && entry.order === page.order && entry.policyId === policyId);
  });
}

/** The same, as plan items: one changed part leaves its whole item to review. Never reports a unit. */
export function itemsPending(pages: readonly Pick<PageMeta, "pageId" | "rev" | "order" | "sourceId">[], ledger: Readonly<PageLedger>, policyId: string): string[] {
  return [...new Set(pagesPending(pages, ledger, policyId).map((page) => page.sourceId))];
}

const STALE_MESSAGE = "Chapters edited during the review were not saved; review them again. Findings for the other chapters were kept.";
const CHECK_STALE_MESSAGE = "This chapter was edited while it was being checked, so the result was not saved. This check was charged. Check it again when you have finished editing.";
const SAVE_MESSAGE = "Some findings could not be saved. Saved findings were kept; the affected chapters remain to review.";
const ALONE_MESSAGE = "This chapter was checked, but not all of the rest of the book has been read yet, so contradictions with other chapters could not all be looked for. Its findings are saved; run a full review to check it against the whole book.";
const unreadMessage = (count: number, refunded?: number): string => `${count === 1 ? "One chapter" : `${count} chapters`} could not be read this time; the rest of the book was checked.${
  refunded ? ` Its ${refunded.toLocaleString("en-US")} credits were refunded.` : ""} Review ${count === 1 ? "it" : "them"} again.`;

export type IncompleteReason = "nothing_to_compare" | "edited_during_check" | "chapter_unread";

export interface MergeRun {
  snapshotId: string;
  source: SourceChoice;
  /** Every page of the book, as sent. */
  pages: PageMeta[];
  /** Grounded in the text sent. */
  issues: EngineIssue[];
  unreadPages: readonly string[];
  /** The engine's caps left some pairs unjudged: nothing may be retired. */
  capped: boolean;
  refundedCredits: number;
  droppedFindings: number;
}

export interface MergeInput {
  prior: ReviewOutcome | null;
  run: MergeRun;
  scope: "full" | "chapters";
  /** Only a sweep (a full review, Review changed chapters) retires findings. A single check never does. */
  reason: "sweep" | "check";
  /** Pages sent whole. */
  checked: readonly string[];
  /** Pages that moved or changed while the review ran. */
  edited: ReadonlySet<string>;
  /** A chapter was added or filled in while the review ran. */
  pageSetChanged: boolean;
  /** A chapter check that could not compare against the book. */
  alone: boolean;
  policyId: string;
  checkedAt: number;
  statusOf(id: string): FindingStatus;
  items: ReadonlyArray<{ id: string; label: string; included: boolean }>;
  /** Every page with text, as reviewed. */
  texts: ReadonlyMap<string, CurrentChapter>;
}

export interface MergeResult {
  review: ReviewOutcome;
  /** Keys this result found, after adoption. A card among these did not go away. */
  survivors: Set<string>;
  /** Cards closed as no longer detected that this result found again. */
  reopened: string[];
  done: string[];
  failed: string[];
  pruned: string[];
  stale: boolean;
  incomplete?: IncompleteReason;
  message?: string;
}

const citedPages = (issue: EngineIssue): string[] => issue.citations.map((citation) => citation.page_id);

export function mergeReview(input: MergeInput): MergeResult {
  const { prior, run, edited } = input;
  const stale = edited.size > 0 || input.pageSetChanged;
  const priorIssues = prior?.issues ?? [];
  const priorClusters = priorIssues.map((issue) => clusterOf(issue, input.statusOf(issue.issue_id)));

  // Keep what still holds: a finding is only as current as every chapter it cites.
  const unedited = stale ? run.issues.filter((issue) => citedPages(issue).every((pageId) => !edited.has(pageId))) : run.issues;
  // A cut page's id moves with its cut; its plan item does not, and its text is still in that item.
  const chapterOf = new Map([...(prior?.pages ?? []), ...run.pages].map((page) => [page.pageId, page.sourceId]));
  const textOf = new Map([...input.texts].map(([pageId, chapter]) => [pageId, chapter.text]));
  for (const page of prior?.pages ?? []) {
    if (textOf.has(page.pageId)) continue;
    const parts = run.pages.filter((p) => p.sourceId === page.sourceId).map((p) => input.texts.get(p.pageId)?.text ?? "");
    if (parts.length > 0) textOf.set(page.pageId, parts.join("\n"));
  }
  const kept = adoptPriorFindings(unedited, priorClusters, textOf, (pageId) => chapterOf.get(pageId) ?? pageId);
  const survivors = new Set(kept.map((issue) => issue.issue_id));

  const unread = new Set(run.unreadPages.filter((pageId) => input.checked.includes(pageId)));
  const failed = input.checked.filter((pageId) => edited.has(pageId) || unread.has(pageId));
  const done = input.alone ? [] : input.checked.filter((pageId) => !failed.includes(pageId));

  // Upsert: a card found again takes the new evidence and keeps its place; a new one goes after.
  const byId = new Map(priorIssues.map((issue) => [issue.issue_id, issue]));
  for (const issue of kept) byId.set(issue.issue_id, issue);
  let issues = [...byId.values()];
  const reopened = kept.map((issue) => issue.issue_id).filter((id) => input.statusOf(id) === "closed_auto");

  // Pruning retires findings a review no longer reproduces. After edits mid-review nothing here proves that, and neither does a
  // review whose caps left pairs unjudged.
  let pruned: string[] = [];
  if (input.reason === "sweep" && done.length > 0 && !stale && !run.capped) {
    const clusters = issues.map((issue) => clusterOf(issue, input.statusOf(issue.issue_id)));
    const checked = new Set(done);
    const sets = pipelineV3PruneSets(clusters, survivors, checked, input.texts);
    const keep = new Set(sets.keep);
    const retired = new Set(sets.stale);
    pruned = clusters.filter((cluster) => !keep.has(cluster.clusterKey) && (retired.has(cluster.clusterKey)
      || (cluster.context.pageIds.length > 0 && cluster.context.pageIds.every((pageId) => checked.has(pageId))))).map((cluster) => cluster.clusterKey);
    const gone = new Set(pruned);
    issues = issues.filter((issue) => !gone.has(issue.issue_id));
  }

  const inBook = new Set(run.pages.map((page) => page.pageId));
  const ledger: PageLedger = {};
  if (input.scope === "chapters") for (const [pageId, entry] of Object.entries(prior?.ledger ?? {})) if (inBook.has(pageId)) ledger[pageId] = entry;
  const sent = new Map(run.pages.map((page) => [page.pageId, page]));
  for (const pageId of done) {
    const page = sent.get(pageId);
    if (page) ledger[pageId] = { rev: page.rev, order: page.order, policyId: input.policyId, checkedAt: input.checkedAt };
  }

  // A page a surviving finding still cites stays known, so its passage can still be opened and named.
  const cited = new Set(issues.flatMap(citedPages));
  const pages = [...run.pages, ...(prior?.pages ?? []).filter((page) => !inBook.has(page.pageId) && cited.has(page.pageId))];

  const included = input.items.filter((item) => item.included);
  const review: ReviewOutcome = {
    checkedAt: input.checkedAt, snapshotId: run.snapshotId, source: run.source, pages, issues, ledger,
    coverage: {
      sources: included.map(({ id, label }) => ({ id, label })),
      unreadSources: included.filter((item) => run.pages.some((page) => page.sourceId === item.id && !ledger[page.pageId])).map((item) => item.id),
      excluded: input.items.length - included.length,
    },
    refundedCredits: run.refundedCredits, droppedFindings: run.droppedFindings,
  };

  const single = input.reason === "check";
  const incomplete: IncompleteReason | undefined = input.alone ? "nothing_to_compare"
    : stale && input.checked.some((pageId) => edited.has(pageId)) ? "edited_during_check"
    : unread.size > 0 ? "chapter_unread" : undefined;
  const message = incomplete === "nothing_to_compare" ? ALONE_MESSAGE
    : incomplete === "edited_during_check" ? (single ? CHECK_STALE_MESSAGE : STALE_MESSAGE)
    : incomplete === "chapter_unread" ? unreadMessage(unread.size, run.refundedCredits) : undefined;
  return { review, survivors, reopened, done, failed, pruned, stale, ...(incomplete ? { incomplete } : {}), ...(message ? { message } : {}) };
}

export { SAVE_MESSAGE };
