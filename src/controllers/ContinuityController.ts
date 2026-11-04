/**
 * The plugin's state and actions (the atomic structure's "hooks" layer for a non-React app): manuscript scan, account,
 * check lifecycle, findings. Pages read its state and call its actions; components below pages receive plain props.
 */
import { Notice, type App } from "obsidian";
import { applyPlan, buildItems, buildUnits, dropNoteIds, holdsNoteId, moveNoteIds, planQuote, snapshotId, sourceContains, type PlannedItem, type SavedPlan, type SourceChoice } from "@/helpers/sources";
import { countWords } from "@/lib/contract/countWords";
import { ProgressTracker } from "@/helpers/progress";
import type { EngineIssueCitation } from "@/lib/contract/engine.types";
import { PipelineV3Client, PipelineV3Error } from "@/lib/contract/pipelineV3Client";
import { PIPELINE_V3_PRICE_OP, type CastMember, type ChapterRead, type PipelineV3Health } from "@/lib/contract/pipelineV3.types";
import { pipelineV3ReviewCredits } from "@/lib/contract/pipelineV3Pricing";
import { selectPassage } from "@/lib/obsidian/editor";
import { secretSessionStore } from "@/lib/obsidian/secretStore";
import { readSourceNotes, sourceOptions } from "@/lib/obsidian/vault";
import { readWorld, removeWorld, writeWorld, type WorldData } from "@/lib/obsidian/worldStore";
import { projectWorld, type WorldEntity, type WorldRow } from "@/helpers/world";
import { AUTH_CONFIG } from "@/lib/services/auth/authConfig";
import { AuthError, TokenSource } from "@/lib/services/auth/authService";
import { claimStarterCredits, formPost, makeTransport, readBalance, type ConnectionOptions } from "@/lib/services/engine/engineService";
import { readProjectState, registerProject } from "@/lib/services/project/projectService";
import { runReview, type ReviewOutcome } from "@/lib/services/review/reviewService";
import { SIGNED_OUT, type Account, type Phase, type PluginData, type Scan } from "@/types";
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
  private projected: { world: WorldData; entities: WorldEntity[] } | null = null;
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
      installId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), dismissed: [], lastReview: null, ...rest,
    };
    // Before the reading plan: the folder setting becomes the picked source, and a review from then cannot be mapped back.
    const folder = typeof manuscriptFolder === "string" ? manuscriptFolder.trim().replace(/^\/+|\/+$/gu, "") : "";
    if (!this.data.source && folder) this.data.source = { kind: "folder", path: folder };
    if (this.data.lastReview && !Array.isArray(this.data.lastReview.pages)) this.data.lastReview = null;
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
  private get busy(): boolean { return this.phase.kind !== "idle" && this.phase.kind !== "error"; }

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
    const changes = holdsNoteId(this.data.noteIds, oldPath) || [this.data.source, this.reviewing, review?.source].some((choice) => choice && follow(choice) !== choice);
    if (!changes) return;
    this.data.noteIds = moveNoteIds(this.data.noteIds, oldPath, path);
    if (this.data.source) this.data.source = follow(this.data.source);
    if (this.reviewing) this.reviewing = follow(this.reviewing);
    if (review) this.data.lastReview = { ...review, source: follow(review.source) };
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
    return {
      status: "ready", source, items: plan.items, needsConfirming: plan.needsConfirming, pages, skipped,
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
    await this.tokens.signOut();
    this.data.lastReview = null;
    await this.save();
    await this.setWorld(null);
    await this.refreshAccount();
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
      await this.runConfirmed(items, scan.source, health, this.priceFor(planQuote(items).chars, health));
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

  private async runConfirmed(items: PlannedItem[], source: SourceChoice, health: PipelineV3Health, credits: number | null): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    this.reviewing = source;
    const tracker = new ProgressTracker();
    const reads: ChapterRead[] = [];
    let cast: CastMember[] = [];
    this.setPhase({ kind: "checking", share: 0, waiting: true });
    try {
      const outcome = await runReview({
        items, source, health, workspaceId: this.data.workspaceId, client: new PipelineV3Client(this.transport()),
        maxCredits: credits ?? undefined, signal: abort.signal,
        onCast: (members) => { cast = members; },
        callbacks: { onRead: (read) => { reads.push(read); }, onProgress: (p) => this.setPhase({ kind: "checking", share: tracker.update(p), waiting: false, stage: p.stage }) },
      });
      this.data.lastReview = { ...outcome, source: this.reviewing ?? outcome.source };
      await this.save();
      await this.setWorld({ snapshotId: outcome.snapshotId, reads, cast });
      this.idle();
      await this.refreshAccount();
    } catch (error) {
      if (error instanceof PipelineV3Error && error.code === "cancelled") this.idle();
      else this.fail(error instanceof Error ? error.message : "The check failed.", error instanceof PipelineV3Error ? error.detail.charged : undefined);
    } finally {
      if (this.abort === abort) this.abort = null;
      this.reviewing = null;
    }
  }

  /** How the free project is named on every surface ("Your free project is …"): the vault is the project. */
  private projectName(): string { return this.app.vault.getName(); }

  /** The in-memory copy stands even if the file cannot be written, so a paid check's World still shows until the next start. */
  private async setWorld(world: WorldData | null): Promise<void> {
    this.world = world;
    try {
      if (world) await writeWorld(this.app, this.host.dir, world);
      else await removeWorld(this.app, this.host.dir);
    } catch (error) {
      console.warn("[Bunsho] could not save the World data", error);
    }
  }

  /** The World of the last check of what is picked now, or null when there is none to show. */
  worldEntities(): WorldEntity[] | null {
    const review = this.currentReview();
    const { world } = this;
    if (!review || !world || world.snapshotId !== review.snapshotId) return null;
    if (this.projected?.world !== world) this.projected = { world, entities: projectWorld(world.cast, world.reads) };
    return this.projected.entities;
  }

  /** The page this fact came from has changed, or is gone, since the check. */
  isStale(row: Pick<WorldRow, "pageId">): boolean {
    const { scan } = this;
    const page = this.currentReview()?.pages.find((p) => p.pageId === row.pageId);
    if (!page || scan.status !== "ready") return true;
    return scan.pages.find((p) => p.pageId === row.pageId)?.rev !== page.rev;
  }

  /** Selects the passage a World fact came from. */
  async jumpToFact(row: WorldRow): Promise<void> {
    await this.jump({ page_id: row.pageId, quoted_text: row.quote, source_ref: { snapshotId: "", pageId: row.pageId, rev: "", start: row.start, end: row.end } });
  }

  private setPhase(phase: Phase): void { this.phase = phase; this.host.changed(); }
  private idle(): void { this.setPhase({ kind: "idle" }); }
  private fail(message: string, charged?: boolean): void { this.setPhase({ kind: "error", message, charged }); }

  cancel(): void { this.abort?.abort(); }

  async dismiss(issueId: string, dismissed: boolean): Promise<void> {
    const set = new Set(this.data.dismissed);
    if (dismissed) set.add(issueId); else set.delete(issueId);
    this.data.dismissed = [...set];
    await this.save();
    this.host.changed();
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
