/**
 * The plugin's state and actions (the atomic structure's "hooks" layer for a non-React app): manuscript scan, account,
 * check lifecycle, findings. Pages read its state and call its actions; components below pages receive plain props.
 */
import { Notice, type App } from "obsidian";
import { forgetCached, mergeCast, pruneReads, worldReads, type KeptRead } from "@/helpers/reads";
import { itemsPending, mergeReview, SAVE_MESSAGE, type FindingStatus, type MergeResult, type PageLedger } from "@/helpers/reviewMerge";
import { applyPlan, buildItems, buildUnits, dropNoteIds, holdsNoteId, itemAtOffset, moveNoteIds, planQuote, snapshotId, sourceContains, sourceProblems, type PlannedItem, type SavedPlan, type SourceChoice } from "@/helpers/sources";
import { countWords } from "@/lib/contract/countWords";
import { ProgressTracker } from "@/helpers/progress";
import type { EngineIssueCitation } from "@/lib/contract/engine.types";
import { PipelineV3Client, PipelineV3Error } from "@/lib/contract/pipelineV3Client";
import { PIPELINE_V3_LIMITS, PIPELINE_V3_PRICE_OP, type ChapterRead, type PipelineV3Health } from "@/lib/contract/pipelineV3.types";
import { pipelineV3ReviewCredits } from "@/lib/contract/pipelineV3Pricing";
import { activeNotePosition, selectPassage } from "@/lib/obsidian/editor";
import { secretSessionStore } from "@/lib/obsidian/secretStore";
import { readSourceNotes, sourceOptions } from "@/lib/obsidian/vault";
import { readWorld, removeWorld, writeWorld, type WorldData } from "@/lib/obsidian/worldStore";
import { projectWorld, type WorldEntity, type WorldRow } from "@/helpers/world";
import { AUTH_CONFIG } from "@/lib/services/auth/authConfig";
import { AuthError, TokenSource } from "@/lib/services/auth/authService";
import { claimStarterCredits, formPost, makeTransport, readBalance, type ConnectionOptions } from "@/lib/services/engine/engineService";
import { readProjectState, registerProject } from "@/lib/services/project/projectService";
import { runReview, type ReviewOutcome, type ReviewRun } from "@/lib/services/review/reviewService";
import { SIGNED_OUT, type Account, type Phase, type PluginData, type ReviewAction, type Scan, type StoppedReview } from "@/types";
import { formatNumber } from "@/utils/format";
import { acceptableEngineUrl, isLocalEngine } from "@/utils/url";

const SCAN_DEBOUNCE_MS = 1500;

export interface CheckQuote { sources: number; noun: string; words: number; credits: number | null; balance: number | null }
export type CheckAnswer = "check" | "plan" | "cancel";

export interface PlanRequest {
  source: SourceChoice;
  items: PlannedItem[];
  /** "check" ends in the priced Check button; "save" only keeps the plan. */
  action: "check" | "save";
  noun: (count: number) => string;
  balance: number | null;
  /** Credits for this many characters, or null when the price cannot be read. */
  priceFor(chars: number): number | null;
}
/** The writer's plan, or that they want a different source. */
export type PlanAnswer = { kind: "plan"; plan: SavedPlan } | { kind: "change_source" };

/** What the controller needs from the plugin it lives in. */
export interface ControllerHost {
  app: App;
  version: string;
  /** The plugin's folder in the vault. */
  dir: string;
  loadData(): Promise<unknown>;
  saveData(data: PluginData): Promise<void>;
  openPanel(): Promise<void>;
  /** Shows the price confirmation; resolves "check" only on an explicit "Check". */
  confirmCheck(quote: CheckQuote): Promise<CheckAnswer>;
  /** The reading plan screen; null when the writer closes it without confirming. */
  reviewPlan(request: PlanRequest): Promise<PlanAnswer | null>;
  /** Asks the writer to pick a folder or note; null when they do not. */
  pickSource(options: ReturnType<typeof sourceOptions>): Promise<SourceChoice | null>;
  /** Confirms switching the free project to this vault. */
  confirmReplaceProject(currentName: string | null): Promise<boolean>;
  /** Re-render whatever shows the state. */
  changed(): void;
}

type ReadyScan = Extract<Scan, { status: "ready" }>;

/** The chapter a check would cover, and what it costs. */
export interface ChapterTarget { id: string; label: string; credits: number }
/** What Check if fixed found. `none`: nothing ran, and the writer has been told or shown why. */
export interface RecheckResult { kind: "closed" | "complete" | "incomplete" | "none"; message: string }

type Prepared =
  | { kind: "ready"; scan: ReadyScan; health: PipelineV3Health; review: ReviewOutcome; scope: Set<string> }
  | { kind: "quiet" }
  | { kind: "refused"; message: string };

type Executed =
  | { kind: "merged"; run: ReviewRun; merged: MergeResult; scan: Scan | null }
  | { kind: "failed"; error: unknown }
  | { kind: "ended" };

const NO_FULL_REVIEW = "Check the whole manuscript first: a chapter can only be checked against a book Bunsho has read.";
const RECHECK_INCOMPLETE = "Recheck incomplete. Existing findings were preserved.";
const NOT_DETECTED = "Issue no longer detected after targeted recheck.";

function validStopped(value: unknown): value is StoppedReview {
  const stopped = value as Partial<StoppedReview> | null;
  return Boolean(stopped) && (stopped?.status === "partial" || stopped?.status === "out_of_credits") && typeof stopped?.source?.path === "string"
    && typeof stopped?.checked === "number" && typeof stopped?.failed === "number" && typeof stopped?.total === "number";
}

/** A review from before the ledger: the pages it read, under no policy, so none of them can count as checked for a chapter check. */
function ledgerOf(review: ReviewOutcome): PageLedger {
  const ledger = (review as Partial<ReviewOutcome>).ledger;
  if (ledger && typeof ledger === "object" && !Array.isArray(ledger)) return ledger;
  const unread = new Set(review.coverage?.unreadSources ?? []);
  return Object.fromEntries(review.pages.filter((page) => !unread.has(page.sourceId))
    .map((page) => [page.pageId, { rev: page.rev, order: page.order, policyId: "", checkedAt: review.checkedAt }]));
}

export class ContinuityController {
  data!: PluginData;
  scan: Scan = { status: "no_source" };
  phase: Phase = { kind: "idle" };
  account: Account = SIGNED_OUT;
  private tokens!: TokenSource;
  private abort: AbortController | null = null;
  private scanTimer: number | undefined;
  private scanSeq = 0;
  private accountSeq = 0;
  private idsChanged = false;
  private world: WorldData | null = null;
  private worldWrites: Promise<void> = Promise.resolve();
  /** Bumped when the local session ends: a review still finishing then keeps nothing. */
  private sessionGen = 0;
  private projected: { world: WorldData; review: ReviewOutcome; entities: WorldEntity[] } | null = null;
  private saving: Promise<void> = Promise.resolve();
  /** The source of the review in flight, which can take minutes: a rename while it runs must reach its result. */
  private reviewing: SourceChoice | null = null;
  private starterClaimed = false; // once per session; the engine itself grants the starter credits only once per account

  constructor(private readonly host: ControllerHost) {}

  async load(): Promise<void> {
    this.tokens = new TokenSource(formPost, secretSessionStore(this.host.app));
    const saved = (await this.host.loadData()) as (Partial<PluginData> & { manuscriptFolder?: unknown }) | null;
    const { manuscriptFolder, ...rest } = saved ?? {};
    this.data = {
      source: null, plan: null, noteIds: {}, engineUrl: AUTH_CONFIG.engineUrl, devUid: "",
      installId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), dismissed: [], deliberate: [], fixed: [], lastReview: null, stopped: null, ...rest,
    };
    // Before the reading plan: the folder setting becomes the picked source, and a review from then cannot be mapped back.
    const folder = typeof manuscriptFolder === "string" ? manuscriptFolder.trim().replace(/^\/+|\/+$/gu, "") : "";
    if (!this.data.source && folder) this.data.source = { kind: "folder", path: folder };
    if (this.data.lastReview && !Array.isArray(this.data.lastReview.pages)) this.data.lastReview = null;
    // data.json can be synced or hand-edited: what the panel reads on every render has to be the shape it expects.
    const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
    this.data.dismissed = ids(this.data.dismissed);
    this.data.deliberate = ids(this.data.deliberate);
    this.data.fixed = ids(this.data.fixed);
    if (this.data.lastReview && !Array.isArray(this.data.lastReview.issues)) this.data.lastReview = null;
    if (this.data.lastReview) this.data.lastReview = { ...this.data.lastReview, ledger: ledgerOf(this.data.lastReview) };
    if (!validStopped(this.data.stopped)) this.data.stopped = null;
    // A vault's data.json can be synced or copied from elsewhere: never send a token to an address that is not ours to trust.
    if (!acceptableEngineUrl(this.data.engineUrl)) this.data.engineUrl = AUTH_CONFIG.engineUrl;
    await this.save();
    this.world = await readWorld(this.app, this.host.dir);
  }

  dispose(): void {
    window.clearTimeout(this.scanTimer);
    this.abort?.abort();
    this.tokens.cancelSignIn();
  }

  /** One write at a time, each with the latest data, so an older snapshot can never finish last and undo a newer one. */
  save(): Promise<void> {
    const write = this.saving.catch(() => undefined).then(() => this.host.saveData(this.data));
    this.saving = write;
    return write;
  }

  /** A check or a dialog is in progress. */
  get busy(): boolean { return this.phase.kind !== "idle" && this.phase.kind !== "error"; }

  private get app(): App { return this.host.app; }
  private get devUid(): string | undefined { return isLocalEngine(this.data.engineUrl) && this.data.devUid ? this.data.devUid : undefined; }

  private connection(): ConnectionOptions {
    return { baseUrl: this.data.engineUrl, tokens: this.tokens, installId: this.data.installId, version: this.host.version,
      devUid: this.devUid, logger: { warn: (m, x) => console.warn(`[Bunsho] ${m}`, x), info: () => undefined } };
  }

  private transport() { return makeTransport(this.connection()); }

  /** Whether a vault change can affect what Bunsho reads (and so needs a rescan). */
  touchesSource(path: string, oldPath?: string): boolean {
    const { source } = this.data;
    if (!source) return false;
    return sourceContains(source, path) || (oldPath !== undefined && sourceContains(source, oldPath)) || path === source.path;
  }

  /** The last review, when it is about what is picked now (the writer may have picked something else since). */
  currentReview(): ReviewOutcome | null {
    const review = this.data.lastReview;
    const { source } = this.data;
    return review && source && review.source.kind === source.kind && review.source.path === source.path ? review : null;
  }

  /** A note or folder moved: the plan, the findings and the picked source all follow it. */
  async moved(path: string, oldPath: string): Promise<void> {
    const follow = <T extends SourceChoice>(choice: T): T => (choice.path === oldPath ? { ...choice, path }
      : choice.path.startsWith(`${oldPath}/`) ? { ...choice, path: `${path}${choice.path.slice(oldPath.length)}` } : choice);
    const review = this.data.lastReview;
    const { stopped } = this.data;
    const changes = holdsNoteId(this.data.noteIds, oldPath) || [this.data.source, this.reviewing, review?.source, stopped?.source].some((choice) => choice && follow(choice) !== choice);
    if (!changes) return;
    this.data.noteIds = moveNoteIds(this.data.noteIds, oldPath, path);
    if (this.data.source) this.data.source = follow(this.data.source);
    if (this.reviewing) this.reviewing = follow(this.reviewing);
    if (review) this.data.lastReview = { ...review, source: follow(review.source) };
    if (stopped) this.data.stopped = { ...stopped, source: follow(stopped.source) };
    await this.save();
  }

  /** A note or folder is gone: a new note at that path is a new note, and the plan will show it. */
  async deleted(path: string): Promise<void> {
    if (!holdsNoteId(this.data.noteIds, path)) return;
    this.data.noteIds = dropNoteIds(this.data.noteIds, path);
    await this.save();
  }

  private noteId(path: string): string {
    const known = this.data.noteIds[path];
    if (known) return known;
    const id = `n${crypto.randomUUID().replace(/-/gu, "").slice(0, 12)}`;
    this.data.noteIds = { ...this.data.noteIds, [path]: id };
    this.idsChanged = true;
    return id;
  }

  /** How the plan and the panel count what is read: a note listed by its headings counts sections, anything else notes. */
  noun(count: number): string {
    const { scan } = this;
    const word = scan.status === "ready" && scan.source.kind === "note" && scan.items.length > 1 ? "section" : "note";
    return count === 1 ? word : `${word}s`;
  }

  async refresh(): Promise<void> {
    await Promise.all([this.refreshScan(), this.refreshAccount()]);
  }

  scheduleScan(): void {
    window.clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => void this.refreshScan(), SCAN_DEBOUNCE_MS);
  }

  /** Keeps the panel current. A note that cannot be read leaves the last scan up; a check reports it through freshScan. */
  async refreshScan(): Promise<void> {
    try { await this.freshScan(); } catch (error) { console.warn("[Bunsho] could not read the notes", error); }
  }

  /** Reads the source now and returns this read's own result, even when a newer scan has since taken over the panel. */
  private async freshScan(): Promise<Scan> {
    window.clearTimeout(this.scanTimer);
    const seq = ++this.scanSeq;
    const { source } = this.data;
    const next = source ? await this.scanSource(source) : { status: "no_source" as const };
    if (seq === this.scanSeq) { // a newer scan started while this one read notes: the panel waits for that one
      this.scan = next;
      this.host.changed();
    }
    if (this.idsChanged) { this.idsChanged = false; await this.save(); }
    return next;
  }

  private async scanSource(source: SourceChoice): Promise<Scan> {
    const notes = await readSourceNotes(this.app, source, (path) => this.noteId(path));
    if (!notes) return { status: "missing", source };
    const { items, skipped } = buildItems(notes, source);
    if (items.length === 0) return { status: "empty", source };
    const plan = applyPlan(items, this.data.plan);
    const { units, pages } = buildUnits(plan.items);
    const itemChars: Record<string, number> = {};
    for (const unit of units) itemChars[unit.sourceId] = (itemChars[unit.sourceId] ?? 0) + unit.text.length;
    return {
      status: "ready", source, items: plan.items, needsConfirming: plan.needsConfirming, pages, skipped, itemChars,
      snapshotId: snapshotId(units),
      chars: units.reduce((n, u) => n + u.text.length, 0), words: units.reduce((n, u) => n + countWords(u.text), 0),
    };
  }

  async refreshAccount(): Promise<void> {
    const seq = ++this.accountSeq;
    const signedIn = (await this.tokens.signedIn()) || Boolean(this.devUid);
    let next: Account = { ...SIGNED_OUT, signedIn };
    if (signedIn) {
      try {
        // Before the balance read, so a writer who has only ever used Obsidian starts with the starter credits.
        if (!this.starterClaimed) this.starterClaimed = await claimStarterCredits(this.connection());
        const transport = this.transport();
        const [health, balance, project] = await Promise.all([
          new PipelineV3Client(transport).health(), readBalance(transport), readProjectState(transport, this.data.workspaceId),
        ]);
        next = { signedIn, health, balance, problem: null, project: project.state, registeredName: project.registeredName };
      } catch (error) {
        if (error instanceof AuthError && error.code === "signed_out") await this.forgetSession();
        next = error instanceof AuthError && error.code === "signed_out" ? { ...SIGNED_OUT, problem: error.message }
          : { ...next, problem: error instanceof PipelineV3Error || error instanceof AuthError ? error.message : "Could not reach Bunsho. Check your connection." };
      }
    }
    if (seq !== this.accountSeq) return; // signed out (or refreshed again) while this was in flight
    this.account = next;
    this.host.changed();
  }

  /** Credits a check of the current manuscript costs, or null when unknown. */
  price(): number | null { return this.scan.status === "ready" ? this.priceFor(this.scan.chars, this.account.health) : null; }

  private priceFor(chars: number, health: PipelineV3Health | null): number | null {
    if (!health) return null;
    return pipelineV3ReviewCredits({ op: PIPELINE_V3_PRICE_OP, creditsPerThousandChars: health.pricing.creditsPerThousandChars, minimumUnits: health.pricing.minimumUnits }, chars);
  }

  async signIn(): Promise<void> {
    try {
      // "_external" goes to the system browser even with Obsidian's Web Viewer on, whose tabs block Google's popup.
      await this.tokens.signIn((url) => window.open(url, "_external"));
      new Notice("Signed in to Bunsho.");
    } catch (error) {
      if (error instanceof AuthError && error.code === "superseded") return; // a newer sign-in, a sign-out or the plugin unloading took over
      new Notice(error instanceof AuthError ? error.message : "Sign-in failed.");
    }
    await this.refreshAccount();
  }

  async signOut(): Promise<void> {
    this.accountSeq++;
    this.starterClaimed = false;
    try {
      await this.tokens.signOut();
    } finally {
      await this.forgetSession();
    }
    await this.refreshAccount();
  }

  /** What this account's check left on this machine goes when the session does, whether the writer signed out or it was revoked. */
  private async forgetSession(): Promise<void> {
    this.sessionGen++;
    this.abort?.abort();
    this.data.lastReview = null;
    this.data.stopped = null;
    this.data.fixed = [];
    try { await this.save(); } finally { await this.setWorld(null); }
  }

  /**
   * Check what the writer picked. Reads the notes and the engine's price fresh, shows the reading plan when it has not been
   * confirmed or has changed, shows the price and asks before anything is spent (from the panel and from the command palette
   * alike), and runs at most one review at a time.
   *
   * The writer's confirmation is of what they were shown, so that is what is sent, at that price. The notes can change while
   * a dialog is open (Obsidian autosaves as they type): those edits wait for the next check.
   */
  async check(): Promise<void> {
    if (this.busy) return;
    this.setPhase({ kind: "preparing" });
    try {
      const [scan] = await Promise.all([this.freshScan(), this.refreshAccount()]);
      const { account } = this;
      const { health } = account;
      if (!account.signedIn) { new Notice(account.problem ?? "Sign in to Bunsho to check your manuscript."); await this.host.openPanel(); return this.idle(); }
      if (scan.status !== "ready") { new Notice("Bunsho: choose what to read first. See the panel."); await this.host.openPanel(); return this.idle(); }
      if (!health) {
        if (account.problem) new Notice(account.problem);
        await this.host.openPanel();
        return this.idle();
      }
      if (account.project === "blocked") return this.idle(); // the panel explains the free plan's one project
      const items = await this.askToCheck(scan, health);
      if (!items) return;
      const problem = this.whyNot(items, health);
      if (problem) return this.fail(problem);
      // The free plan's one project becomes this vault, on the writer's first confirmed check.
      if (account.project === "unregistered") await registerProject(this.connection(), this.data.workspaceId, this.projectName());
      await this.runAction({ kind: "full" }, items, scan.source, health, this.priceFor(planQuote(items).chars, health), null, "sweep");
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "The check failed.");
    }
  }

  /** The reading plan, or just the price when the plan stands. Returns what the writer confirmed; null leaves the panel as it should be. */
  private async askToCheck(scan: ReadyScan, health: PipelineV3Health): Promise<PlannedItem[] | null> {
    if (scan.needsConfirming || scan.pages.length === 0) return this.openPlan(scan, "check", health);
    const problem = this.whyNot(scan.items, health);
    if (problem) { this.fail(problem); return null; }
    this.setPhase({ kind: "confirming" });
    const sources = scan.items.filter((item) => item.included).length;
    const answer = await this.host.confirmCheck({ sources, noun: this.noun(sources), words: scan.words, credits: this.priceFor(scan.chars, health), balance: this.account.balance });
    if (answer === "plan") return this.openPlan(scan, "check", health);
    if (answer === "cancel") { this.idle(); return null; }
    return scan.items;
  }

  /** Why a check of these items cannot run, in the writer's words; said before anything is sent or spent. */
  private whyNot(items: readonly PlannedItem[], health: PipelineV3Health): string | null {
    const quote = planQuote(items);
    if (quote.units === 0) return "Nothing is ticked in the reading plan.";
    if (quote.problems.length > 0) return quote.problems[0];
    if (quote.hasParts && !health.readingParts) return "Part of this is too long to read in one go, and the Bunsho service cannot read it in pieces yet. You were not charged.";
    const { balance } = this.account;
    const credits = this.priceFor(quote.chars, health);
    if (credits !== null && balance !== null && balance < credits) {
      return `This check costs about ${formatNumber(credits)} credits and you have ${formatNumber(balance)}. Add credits in Bunsho, then try again.`;
    }
    return null;
  }

  /** The reading plan screen, over what this scan read. Returns the items as the writer left them; null when they did not confirm. */
  private async openPlan(scan: ReadyScan, action: "check" | "save", health: PipelineV3Health | null): Promise<PlannedItem[] | null> {
    this.setPhase({ kind: "confirming" });
    const answer = await this.host.reviewPlan({
      source: scan.source, items: scan.items, action, noun: (count) => this.noun(count), balance: this.account.balance, priceFor: (chars) => this.priceFor(chars, health),
    });
    if (answer?.kind === "change_source") { this.idle(); await this.chooseSource(); return null; }
    if (!answer) { this.idle(); return null; }
    this.data.plan = answer.plan;
    await this.save();
    await this.refreshScan();
    return applyPlan(scan.items, answer.plan).items;
  }

  /** Reading plan from the panel: looks and edits, spends nothing. */
  async editPlan(): Promise<void> {
    if (this.busy) return;
    this.setPhase({ kind: "preparing" });
    try {
      const scan = await this.freshScan();
      if (scan.status !== "ready") { new Notice("Bunsho: choose what to read first."); return this.idle(); }
      await this.openPlan(scan, "save", this.account.health);
      if (this.phase.kind === "confirming") this.idle();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Could not read your notes.");
    }
  }

  /** Lets the writer pick what Bunsho reads, then shows them how it will read it. */
  async chooseSource(): Promise<void> {
    if (this.busy) { new Notice("Bunsho is busy with a check. Try again when it finishes."); return; }
    this.setPhase({ kind: "confirming" });
    try {
      const choice = await this.host.pickSource(sourceOptions(this.app));
      if (!choice) return this.idle();
      const same = this.data.source?.kind === choice.kind && this.data.source.path === choice.path;
      this.data.source = choice;
      if (!same) this.data.plan = null;
      await this.save();
      const scan = await this.freshScan();
      this.idle();
      if (scan.status === "ready") await this.openPlan(scan, "save", this.account.health);
      if (this.phase.kind === "confirming") this.idle();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Could not read your notes.");
    }
  }

  /** The free plan's "replaces unlimited": this vault becomes the one project, on the writer's say-so. */
  async replaceFreeProject(): Promise<void> {
    if (!(await this.host.confirmReplaceProject(this.account.registeredName))) return;
    try {
      await registerProject(this.connection(), this.data.workspaceId, this.projectName());
      new Notice("This vault is now your free project.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not switch your free project.");
    }
    await this.refreshAccount();
  }

  /**
   * Chapter checks compare against the book, so they wait for a whole-book check under the engine's current read policy. A
   * check without that could only look inside the chapter, at the same price. This is the one place the plugins differ from
   * the desktop, which charges for that check and says so afterwards.
   */
  chapterChecksOpen(): boolean {
    const { account, world, scan } = this;
    const { health } = account;
    if (!health || !account.signedIn || account.project === "blocked" || !world?.fromFullReview || scan.status !== "ready" || !this.currentReview()) return false;
    return world.reads.some((entry) => entry.readPolicyId === health.readPolicyId);
  }

  /** The plan items not checked at their current text, place and policy, and what reviewing them costs. Null before a first full review. */
  changedChapters(): { count: number; credits: number } | null {
    const { scan } = this;
    const review = this.currentReview();
    const { health } = this.account;
    if (!this.chapterChecksOpen() || scan.status !== "ready" || !review || !health) return null;
    const ids = itemsPending(scan.pages, review.ledger, health.policyId);
    const credits = this.priceFor(ids.reduce((n, id) => n + (scan.itemChars[id] ?? 0), 0), health);
    return ids.length > 0 && credits !== null ? { count: ids.length, credits } : null;
  }

  /** The chapter under the writer's cursor. A chapter is a plan item, however many pieces it reads in. */
  chapterTarget(): ChapterTarget | null {
    const { scan } = this;
    if (!this.chapterChecksOpen() || scan.status !== "ready") return null;
    const position = activeNotePosition(this.app);
    const noteId = position ? this.data.noteIds[position.path] : undefined;
    const item = position && noteId ? itemAtOffset(scan.items, noteId, position.offset) : null;
    const credits = item ? this.priceFor(scan.itemChars[item.id] ?? 0, this.account.health) : null;
    return item && credits !== null ? { id: item.id, label: item.label, credits } : null;
  }

  /** The plan items a finding cites, or null when one has gone from the plan and so cannot be checked. */
  private recheckItems(issueId: string, scan: ReadyScan, review: ReviewOutcome): string[] | null {
    const issue = review.issues.find((i) => i.issue_id === issueId);
    if (!issue) return null;
    const pages = new Map(review.pages.map((page) => [page.pageId, page]));
    const ids = new Set<string>();
    for (const citation of issue.citations) {
      const id = pages.get(citation.page_id)?.sourceId;
      if (!id || !scan.items.some((item) => item.id === id && item.included)) return null;
      ids.add(id);
    }
    return ids.size > 0 ? [...ids] : null;
  }

  /** What Check if fixed costs for this finding: every chapter it cites, whole, in one review. Null when it cannot run. */
  recheckQuote(issueId: string): number | null {
    const { scan } = this;
    const review = this.currentReview();
    if (!this.chapterChecksOpen() || scan.status !== "ready" || !review) return null;
    const ids = this.recheckItems(issueId, scan, review);
    return ids ? this.priceFor(ids.reduce((n, id) => n + (scan.itemChars[id] ?? 0), 0), this.account.health) : null;
  }

  /** Review changed chapters, at the price on the button: the click is the consent, and the price binds. */
  async reviewChanged(quoted: number): Promise<void> {
    if (this.busy) return;
    this.setPhase({ kind: "preparing" });
    try {
      const prepared = await this.prepareScoped(quoted, (scan, review, health) => itemsPending(scan.pages, review.ledger, health.policyId));
      if (prepared.kind === "quiet") return this.idle();
      if (prepared.kind === "refused") return this.fail(prepared.message);
      await this.runAction({ kind: "changes" }, prepared.scan.items, prepared.scan.source, prepared.health, quoted, prepared.scope, "sweep");
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "The review failed.");
    }
  }

  /** Check one chapter, at the price the writer confirmed. */
  async checkChapter(itemId: string, quoted: number): Promise<void> {
    if (this.busy) return;
    this.setPhase({ kind: "preparing" });
    try {
      const prepared = await this.prepareScoped(quoted, (scan) => (scan.items.some((item) => item.id === itemId && item.included) ? [itemId] : null));
      if (prepared.kind === "quiet") return this.idle();
      if (prepared.kind === "refused") return this.fail(prepared.message);
      await this.runAction({ kind: "chapter", itemId }, prepared.scan.items, prepared.scan.source, prepared.health, quoted, prepared.scope, "check");
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "The check failed.");
    }
  }

  /**
   * Check if fixed. Only the card asked about can close, and only on proof: the review completed, nothing moved while it ran,
   * the policy still stands, every chapter the card cites was read whole, and the problem is not among what came back once
   * re-found findings have taken their old cards' keys. Not finding a problem in text nobody has edited proves nothing, since
   * a model's findings vary a little run to run, so a card whose cited chapters are all unchanged stays open.
   */
  async recheck(issueId: string, quoted: number): Promise<RecheckResult> {
    const incomplete = (detail: string): RecheckResult => ({ kind: "incomplete", message: `${RECHECK_INCOMPLETE} ${detail}` });
    if (this.busy) return { kind: "none", message: "" };
    this.setPhase({ kind: "preparing" });
    try {
      const prepared = await this.prepareScoped(quoted, (scan, review) => this.recheckItems(issueId, scan, review));
      if (prepared.kind === "quiet") { this.idle(); return { kind: "none", message: "" }; }
      if (prepared.kind === "refused") { this.idle(); return incomplete(prepared.message); }
      const { scan, health, review, scope } = prepared;
      const issue = review.issues.find((i) => i.issue_id === issueId);
      const revs = new Map(scan.pages.map((page) => [page.pageId, page.rev]));
      const edited = issue?.citations.some((citation) => revs.get(citation.page_id) !== citation.source_ref?.rev) ?? false;

      const done = await this.execute(scan.items, scan.source, health, quoted, scope, "check");
      if (done.kind === "ended") { this.idle(); return { kind: "none", message: "" }; }
      if (done.kind === "failed") {
        this.idle();
        await this.refreshAccount();
        return incomplete(done.error instanceof Error ? done.error.message : "The check failed.");
      }
      const { run, merged, scan: after } = done;
      const proven = merged.failed.length === 0 && !merged.incomplete && !merged.stale && !run.capped
        && after?.status === "ready" && after.snapshotId === run.snapshotId && !merged.survivors.has(issueId) && edited
        && await this.policyStands(health);
      if (proven) this.data.fixed = [...new Set([...this.data.fixed, issueId])];
      const saved = await this.persist(merged, run, scan.items, scope, quoted);
      if (!saved && proven) this.data.fixed = this.data.fixed.filter((id) => id !== issueId);
      this.idle();
      await this.refreshAccount();
      if (!saved) return incomplete(SAVE_MESSAGE);
      if (merged.message) return incomplete(merged.message);
      return proven ? { kind: "closed", message: NOT_DETECTED } : { kind: "complete", message: "Recheck complete." };
    } catch (error) {
      this.idle();
      return incomplete(error instanceof Error ? error.message : "The check failed.");
    }
  }

  /** The engine still reviews under the policy this ran under. An answer that cannot be had proves nothing. */
  private async policyStands(health: PipelineV3Health): Promise<boolean> {
    try {
      const now = await new PipelineV3Client(this.transport()).health();
      return now.policyId === health.policyId;
    } catch { return false; }
  }

  /** What a review of part of the book needs before anything is spent. New or changed lines on the plan go through the writer first. */
  private async prepareScoped(quoted: number, pick: (scan: ReadyScan, review: ReviewOutcome, health: PipelineV3Health) => string[] | null): Promise<Prepared> {
    const [scan] = await Promise.all([this.freshScan(), this.refreshAccount()]);
    const { account } = this;
    const { health } = account;
    if (!account.signedIn) { new Notice(account.problem ?? "Sign in to Bunsho to check your manuscript."); await this.host.openPanel(); return { kind: "quiet" }; }
    if (scan.status !== "ready") { new Notice("Bunsho: choose what to read first. See the panel."); await this.host.openPanel(); return { kind: "quiet" }; }
    if (!health) { if (account.problem) new Notice(account.problem); await this.host.openPanel(); return { kind: "quiet" }; }
    if (account.project === "blocked") return { kind: "quiet" };
    if (scan.needsConfirming) { await this.openPlan(scan, "save", health); return { kind: "quiet" }; }
    const review = this.currentReview();
    if (!review || !this.chapterChecksOpen()) return { kind: "refused", message: NO_FULL_REVIEW };
    const ids = pick(scan, review, health);
    if (!ids || ids.length === 0) return { kind: "quiet" };
    const scope = new Set(ids);
    const problem = this.whyNotScoped(scan, scope, health, quoted);
    return problem ? { kind: "refused", message: problem } : { kind: "ready", scan, health, review, scope };
  }

  /** whyNot, for a review that sends only some chapters whole: the rest are passages, listed but never charged. */
  private whyNotScoped(scan: ReadyScan, scope: ReadonlySet<string>, health: PipelineV3Health, quoted: number): string | null {
    const { units } = buildUnits(scan.items, () => "");
    if (units.length > PIPELINE_V3_LIMITS.maxPages) return planQuote(scan.items).problems[0] ?? null;
    if (units.some((unit) => unit.part) && !health.readingParts) return "Part of this is too long to read in one go, and the Bunsho service cannot read it in pieces yet. You were not charged.";
    const problems = sourceProblems(units.filter((unit) => scope.has(unit.sourceId)));
    if (problems.length > 0) return problems[0];
    const { balance } = this.account;
    return balance !== null && balance < quoted
      ? `This check costs about ${formatNumber(quoted)} credits and you have ${formatNumber(balance)}. Add credits in Bunsho, then try again.` : null;
  }

  private async runAction(action: ReviewAction, items: PlannedItem[], source: SourceChoice, health: PipelineV3Health, credits: number | null, scope: Set<string> | null, reason: "sweep" | "check"): Promise<void> {
    const done = await this.execute(items, source, health, credits, scope, reason);
    if (done.kind === "ended") return this.idle();
    if (done.kind === "failed") return this.reviewFailed(done.error, action, source, scope?.size ?? items.filter((item) => item.included).length, credits);
    await this.persist(done.merged, done.run, items, scope, credits);
    this.idle();
    await this.refreshAccount();
  }

  /**
   * Runs one review and merges its result into a new review, nothing saved yet. Whatever the engine read is kept even when the
   * review fails: a charged failure sends its reads before its error, and a retry should not make the engine read them again.
   */
  private async execute(items: PlannedItem[], source: SourceChoice, health: PipelineV3Health, credits: number | null, scope: Set<string> | null, reason: "sweep" | "check"): Promise<Executed> {
    const abort = new AbortController();
    this.abort = abort;
    this.reviewing = source;
    const tracker = new ProgressTracker();
    const session = this.sessionGen;
    const fresh: ChapterRead[] = [];
    const { world } = this;
    this.setPhase({ kind: "checking", share: 0, waiting: true });
    try {
      let run: ReviewRun;
      try {
        run = await runReview({
          items, source, health, workspaceId: this.data.workspaceId, client: new PipelineV3Client(this.transport()), scope,
          known: world ? { reads: world.reads, cast: world.cast, fromFullReview: world.fromFullReview } : undefined,
          maxCredits: credits ?? undefined, signal: abort.signal,
          callbacks: { onRead: (read) => { fresh.push(read); }, onProgress: (p) => this.setPhase({ kind: "checking", share: tracker.update(p), waiting: false, stage: p.stage }) },
        });
      } catch (error) {
        if (session !== this.sessionGen) return { kind: "ended" };
        await this.keepReads(fresh, health, items, error);
        return { kind: "failed", error };
      }
      if (session !== this.sessionGen) return { kind: "ended" }; // signed out while it ran

      let now: Scan | null = null;
      try { now = await this.freshScan(); } catch (error) { console.warn("[Bunsho] could not read the notes after a review", error); }
      if (session !== this.sessionGen) return { kind: "ended" };
      const current = new Map(now?.status === "ready" ? now.pages.map((page) => [page.pageId, page]) : []);
      const edited = new Set(run.pages.filter((page) => { const moved = current.get(page.pageId); return !moved || moved.rev !== page.rev || moved.order !== page.order; }).map((page) => page.pageId));
      const sent = new Set(run.pages.map((page) => page.pageId));
      const merged = mergeReview({
        prior: this.currentReview(), run: { ...run, source: this.reviewing ?? run.source }, scope: scope ? "chapters" : "full", reason, checked: run.checked, edited,
        pageSetChanged: [...current.keys()].some((pageId) => !sent.has(pageId)), alone: run.alone, policyId: health.policyId, checkedAt: run.checkedAt,
        statusOf: (id) => this.statusOf(id), items, texts: run.texts,
      });
      // Reads streamed under a read policy other than the one they were filed under cannot be sent back.
      const sameReadPolicy = run.readPolicyId === health.readPolicyId;
      const kept: KeptRead[] = [...(sameReadPolicy ? world?.reads ?? [] : forgetCached(world?.reads ?? [])), ...fresh.map((read) => ({ readPolicyId: sameReadPolicy ? health.readPolicyId : null, read }))];
      await this.setWorld({
        reads: pruneReads(kept, merged.review.ledger, new Set(current.keys())),
        cast: mergeCast(world?.cast ?? [], run.cast, scope ? "chapters" : "full"),
        fromFullReview: scope ? world?.fromFullReview ?? false : true,
      });
      return { kind: "merged", run, merged, scan: now };
    } finally {
      if (this.abort === abort) this.abort = null;
      this.reviewing = null;
    }
  }

  private async keepReads(fresh: readonly ChapterRead[], health: PipelineV3Health, items: PlannedItem[], error: unknown): Promise<void> {
    // The engine checks every cached read before charging; one it refuses fails the whole start. Forget them, so the next attempt
    // reads those chapters again instead of failing the same way. The World can still show them.
    const refused = error instanceof PipelineV3Error && error.code === "invalid_request";
    const { world } = this;
    if (fresh.length === 0 && !(refused && world)) return;
    const reads = [...(refused ? forgetCached(world?.reads ?? []) : world?.reads ?? []), ...fresh.map((read) => ({ readPolicyId: health.readPolicyId, read }))];
    const inBook = new Set(buildUnits(items, () => "").pages.map((page) => page.pageId));
    await this.setWorld({ reads: pruneReads(reads, this.currentReview()?.ledger ?? {}, inBook), cast: world?.cast ?? [], fromFullReview: world?.fromFullReview ?? false });
  }

  /** Stores a merged review and what stopped it, if anything did. False when it could not be saved: it still shows until restart. */
  private async persist(merged: MergeResult, run: ReviewRun, items: readonly PlannedItem[], scope: ReadonlySet<string> | null, credits: number | null): Promise<boolean> {
    const reopened = new Set(merged.reopened);
    this.data.fixed = this.data.fixed.filter((id) => !reopened.has(id));
    this.data.lastReview = merged.review;
    this.data.stopped = merged.incomplete ? this.stoppedFrom("partial", merged, run, items, scope, merged.message ?? null, credits) : null;
    try {
      await this.save();
      return true;
    } catch (error) {
      console.warn("[Bunsho] could not save the review", error);
      this.data.stopped = this.stoppedFrom("partial", merged, run, items, scope, SAVE_MESSAGE, credits);
      return false;
    }
  }

  /** A stopped review's counts, by plan item: a chapter counts once every piece of it was checked. */
  private stoppedFrom(status: StoppedReview["status"], merged: MergeResult, run: ReviewRun, items: readonly PlannedItem[], scope: ReadonlySet<string> | null, message: string | null, credits: number | null): StoppedReview {
    const asked = items.filter((item) => item.included && (!scope || scope.has(item.id)));
    const done = new Set(merged.done);
    const checked = asked.filter((item) => run.pages.filter((page) => page.sourceId === item.id).every((page) => done.has(page.pageId))).length;
    return { status, source: run.source, checked, failed: asked.length - checked, total: asked.length, message, credits };
  }

  /** The writer's words for a review that did not come back. Their findings are always left as they were. */
  private async reviewFailed(error: unknown, action: ReviewAction, source: SourceChoice, total: number, credits: number | null): Promise<void> {
    const stop = async (stopped: StoppedReview): Promise<void> => {
      this.data.stopped = stopped;
      try { await this.save(); } catch (saveError) { console.warn("[Bunsho] could not save", saveError); }
    };
    if (error instanceof PipelineV3Error && error.code === "cancelled") {
      // A review stopped before the engine charged it leaves nothing to say.
      if (error.detail.charged) await stop({ status: "partial", source, checked: 0, failed: total, total, message: error.message, credits });
      this.idle();
      return;
    }
    if (error instanceof PipelineV3Error && error.code === "insufficient_credits") {
      await stop({ status: "out_of_credits", source, checked: 0, failed: total, total, message: null, credits });
      this.idle();
      await this.refreshAccount();
      return;
    }
    const charged = error instanceof PipelineV3Error ? error.detail.charged : undefined;
    // A size refusal says what to do instead; trying again would fail the same way.
    const canRetry = !(error instanceof PipelineV3Error && error.code === "too_large");
    this.setPhase({ kind: "error", message: error instanceof Error ? error.message : "The check failed.", charged, ...(canRetry ? { action } : {}) });
    await this.refreshAccount();
  }

  /** The review that failed, at what it costs now. Null when it no longer can run. */
  retryQuote(): number | null {
    const { phase, scan } = this;
    if (phase.kind !== "error" || !phase.action || scan.status !== "ready") return null;
    if (phase.action.kind === "full") return this.price();
    if (phase.action.kind === "changes") return this.changedChapters()?.credits ?? null;
    const { itemId } = phase.action;
    return scan.itemChars[itemId] === undefined ? null : this.priceFor(scan.itemChars[itemId], this.account.health);
  }

  /** Tries the failed review again, at the price on its button. A full review goes through its own price dialog. */
  async retry(): Promise<void> {
    const { phase } = this;
    if (phase.kind !== "error" || !phase.action) return;
    const { action } = phase;
    const quoted = this.retryQuote();
    this.idle();
    if (action.kind === "full") return this.check();
    if (quoted === null) return;
    if (action.kind === "changes") return this.reviewChanged(quoted);
    return this.checkChapter(action.itemId, quoted);
  }

  /** What stopped the last review, when it is about what is picked now. */
  stoppedReview(): StoppedReview | null {
    const { stopped, source } = this.data;
    return stopped && source && stopped.source.kind === source.kind && stopped.source.path === source.path ? stopped : null;
  }

  /** The writer has read why the review stopped. The status line still says so until the next review. */
  async dismissStopped(): Promise<void> {
    if (!this.data.stopped) return;
    this.data.stopped = { ...this.data.stopped, message: null };
    this.host.changed();
    await this.save();
  }

  private statusOf(id: string): FindingStatus {
    if (this.data.dismissed.includes(id)) return "dismissed";
    if (this.data.deliberate.includes(id)) return "closed_manual";
    return this.data.fixed.includes(id) ? "closed_auto" : "open";
  }

  /** How the free project is named on every surface ("Your free project is …"): the vault is the project. */
  private projectName(): string { return this.app.vault.getName(); }

  /** The in-memory copy stands even if the file cannot be written, so a paid check's World still shows until the next start. */
  private setWorld(world: WorldData | null): Promise<void> {
    this.world = world;
    const write = this.worldWrites.then(async () => {
      if (world) await writeWorld(this.app, this.host.dir, world);
      else await removeWorld(this.app, this.host.dir);
    }).catch((error: unknown) => { console.warn("[Bunsho] could not save the World data", error); });
    this.worldWrites = write;
    return write;
  }

  /** The World as the checks of what is picked now read it, each page at its last check. Null when there is none to show. */
  worldEntities(): WorldEntity[] | null {
    const review = this.currentReview();
    const { world } = this;
    if (!review || !world) return null;
    try {
      if (this.projected?.world === world && this.projected.review === review) return this.projected.entities;
      const reads = worldReads(world.reads, review.ledger);
      if (reads.length === 0) return null;
      this.projected = { world, review, entities: projectWorld(world.cast, reads) };
      return this.projected.entities;
    } catch (error) {
      console.warn("[Bunsho] could not build the World", error);
      return null;
    }
  }

  /** What this World lacks because no check has fully read that part of the story, in the writer's terms. */
  worldGaps(): string[] {
    const review = this.currentReview();
    const { world } = this;
    if (!review || !world) return [];
    const read = new Set(worldReads(world.reads, review.ledger).map((r) => r.pageId));
    const plan = new Set(review.coverage.sources.map((source) => source.id));
    return [...new Set(review.pages.filter((p) => plan.has(p.sourceId) && !read.has(p.pageId)).map((p) => p.label))];
  }

  /** Why a fact may no longer match the story: its page changed or left the plan since the check. Null when it still stands. */
  factNote(row: Pick<WorldRow, "pageId">): string | null {
    const { scan } = this;
    const review = this.currentReview();
    const page = review?.pages.find((p) => p.pageId === row.pageId);
    if (!review || !page || scan.status !== "ready") return "edited since the check";
    if (scan.items.some((item) => item.id === page.sourceId && !item.included)) return "left out of the reading plan since the check";
    return scan.pages.find((p) => p.pageId === row.pageId)?.rev === (review.ledger[row.pageId]?.rev ?? page.rev) ? null : "edited since the check";
  }

  /** Selects the passage a World fact came from. */
  async jumpToFact(row: WorldRow): Promise<void> {
    await this.jump({ page_id: row.pageId, quoted_text: row.quote, source_ref: { snapshotId: "", pageId: row.pageId, rev: "", start: row.start, end: row.end } });
  }

  private setPhase(phase: Phase): void { this.phase = phase; this.host.changed(); }
  private idle(): void { this.setPhase({ kind: "idle" }); }
  private fail(message: string, charged?: boolean): void { this.setPhase({ kind: "error", message, charged }); }

  cancel(): void { this.abort?.abort(); }

  async dismiss(issueId: string, dismissed: boolean): Promise<void> { await this.setDecisions(issueId, { dismissed }); }

  /** "This is deliberate" on the Resolve screen: the difference is intended. */
  async markDeliberate(issueId: string, deliberate: boolean): Promise<void> { await this.setDecisions(issueId, { deliberate }); }

  /** Reopens a settled finding, whichever way it was settled. */
  async restoreFinding(issueId: string): Promise<void> { await this.setDecisions(issueId, { dismissed: false, deliberate: false, fixed: false }); }

  /** A decision that could not be saved is taken back and the failure reported, so the panel never shows one a restart would lose. */
  private async setDecisions(issueId: string, change: Partial<Record<"dismissed" | "deliberate" | "fixed", boolean>>): Promise<void> {
    const KEYS = ["dismissed", "deliberate", "fixed"] as const;
    const apply = (key: (typeof KEYS)[number], on: boolean) => {
      const set = new Set(this.data[key]);
      if (on) set.add(issueId); else set.delete(issueId);
      this.data[key] = [...set];
    };
    const before = { dismissed: this.data.dismissed.includes(issueId), deliberate: this.data.deliberate.includes(issueId), fixed: this.data.fixed.includes(issueId) };
    for (const key of KEYS) if (change[key] !== undefined) apply(key, change[key]);
    try {
      await this.save();
    } catch (error) {
      for (const key of KEYS) if (change[key] !== undefined) apply(key, before[key]);
      throw error;
    } finally {
      this.host.changed();
    }
  }

  async jump(citation: Pick<EngineIssueCitation, "page_id" | "quoted_text" | "source_ref">): Promise<void> {
    const page = this.currentReview()?.pages.find((p) => p.pageId === citation.page_id);
    if (!page) return;
    // By id, so a note renamed since the check is still found.
    const path = Object.entries(this.data.noteIds).find(([, id]) => id === page.noteId)?.[0] ?? page.path;
    await selectPassage(this.app, path, page.noteOffset, citation);
  }

  /** Keeps the last good address until the text is a valid one. */
  async setEngineUrl(value: string): Promise<void> {
    const next = value.trim() || AUTH_CONFIG.engineUrl;
    if (!acceptableEngineUrl(next)) return;
    this.data.engineUrl = next;
    await this.save();
  }

  async setDevUid(value: string): Promise<void> { this.data.devUid = value.trim(); await this.save(); }
}
