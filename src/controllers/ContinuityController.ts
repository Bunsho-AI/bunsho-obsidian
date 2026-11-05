/**
 * The plugin's state and actions (the atomic structure's "hooks" layer for a non-React app): manuscript scan, account,
 * check lifecycle, findings. Pages read its state and call its actions; components below pages receive plain props.
 */
import { Notice, type App } from "obsidian";
import { forgetCached, mergeCast, pruneReads, usableReads, worldReads, type KeptRead } from "@/helpers/reads";
import { CANON_SAVE_MESSAGE, CANON_UNREAD_MESSAGE, itemsPending, mergeCanonPass, mergeReview, parseLedger, SAVE_MESSAGE, type FindingStatus, type MergeResult, type PageLedger } from "@/helpers/reviewMerge";
import { applyPlan, buildItems, buildUnits, dropNoteIds, holdsNoteId, itemAtOffset, moveNoteIds, planQuote, snapshotId, sourceContains, sourceProblems, type PlannedItem, type SavedPlan, type SourceChoice } from "@/helpers/sources";
import { countWords } from "@/lib/contract/countWords";
import { ProgressTracker } from "@/helpers/progress";
import type { EngineIssue, EngineIssueCitation } from "@/lib/contract/engine.types";
import { PipelineV3Client, PipelineV3Error } from "@/lib/contract/pipelineV3Client";
import { PIPELINE_V3_LIMITS, PIPELINE_V3_PRICE_OP, type ChapterRead, type PipelineV3Health } from "@/lib/contract/pipelineV3.types";
import { pipelineV3ReviewCredits } from "@/lib/contract/pipelineV3Pricing";
import { activeNotePosition, selectPassage } from "@/lib/obsidian/editor";
import { secretSessionStore, sessionOwnerStore } from "@/lib/obsidian/secretStore";
import { readSourceNotes, sourceOptions } from "@/lib/obsidian/vault";
import { readWorld, removeWorld, writeWorld, type WorldData } from "@/lib/obsidian/worldStore";
import { accountDir, accountKey, followHeld, NO_ACCOUNT_STATE, parseLastPlan, parseOtherAccounts, settleAccount } from "@/helpers/accounts";
import { SUPPORT_EMAIL, supportMailto } from "@/helpers/support";
import { projectWorld, type WorldEntity, type WorldRow } from "@/helpers/world";
import { AUTH_CONFIG } from "@/lib/services/auth/authConfig";
import { AuthError, TokenSource, uidOfToken } from "@/lib/services/auth/authService";
import { claimStarterCredits, formPost, makeTransport, readCredits, type ConnectionOptions } from "@/lib/services/engine/engineService";
import { readProjectState, registerProject } from "@/lib/services/project/projectService";
import { canonCredits, MAX_PINS, runCanonReview, runReview, type ReviewOutcome, type ReviewRun } from "@/lib/services/review/reviewService";
import { lapsedPlan } from "@/helpers/account";
import { buildCanonConflictView, CANON_CONFLICT_ISSUE_TYPE, type CanonConflictView } from "@/helpers/canon/conflict";
import { capKey, dimensionEntry } from "@/helpers/canon/dimensions";
import { addAlias, addEntity, addFact, editFact, pinFound, removeEntity, removeFact, renameEntity, unpinFact, type AddEntityOutcome, type CanonTarget, type EntityRef, type FactPatch, type FoundFact, type HandFact, type IdentityResolution, type PenContext, type PenResult } from "@/helpers/canon/pen";
import { writerPinDigest, writerPins } from "@/helpers/canon/pins";
import { emptyCanon, MAX_DIMENSION_CHARS, nfcKey, type CanonTracking } from "@/helpers/canon/record";
import { foundEntities, mergeRecord, type RecordEntity } from "@/helpers/canon/world";
import { removeScenes } from "@/lib/obsidian/sceneStore";
import { seedTracking, projectPipelineV3World, type EngineTracking } from "@/helpers/director/world";
import { rankCast, type DirectorCastMember } from "@/helpers/director/cast";
import { BROKEN, readCanon, removeCanon, writeCanon, type CanonBook } from "@/lib/obsidian/canonStore";
import { DATA_FOLDER, dataFolderOf, followFolder, moveToVault, removeIfEmpty } from "@/lib/obsidian/vaultFolder";
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
  /** The Jump to issue picker; null when the writer closes it. */
  pickIssue(open: readonly EngineIssue[], coordinate: (issue: EngineIssue) => string): Promise<EngineIssue | null>;
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
  | { kind: "merged"; run: ReviewRun; merged: MergeResult; scan: Scan | null; pinDigest: string }
  | { kind: "failed"; error: unknown }
  | { kind: "ended" };

const NO_FULL_REVIEW = "Check the whole manuscript first: a chapter can only be checked against a book Bunsho has read.";
/** Without the writer's pins a review would miss every canon conflict, and retire every canon card. */
const CANON_UNREADABLE = `Bunsho could not read your canon, so a check could not hold your prose against it. You were not charged. A copy of the file was kept as ${BROKEN} in the Bunsho folder of your vault: mend it, or remove your canon with Delete my Bunsho data.`;
const RECHECK_INCOMPLETE = "Recheck incomplete. Existing findings were preserved.";
const NOT_DETECTED = "Issue no longer detected after targeted recheck.";

function validStopped(value: unknown): value is StoppedReview {
  const stopped = value as Partial<StoppedReview> | null;
  return Boolean(stopped) && (stopped?.status === "partial" || stopped?.status === "out_of_credits") && typeof stopped?.source?.path === "string"
    && typeof stopped?.checked === "number" && typeof stopped?.failed === "number" && typeof stopped?.total === "number";
}

/** A review from before the ledger: the pages it read, under no policy, so none of them can count as checked for a chapter check. */
function ledgerOf(review: ReviewOutcome): PageLedger {
  const ledger = parseLedger((review as { ledger?: unknown }).ledger);
  if (ledger) return ledger;
  const unread = new Set(review.coverage?.unreadSources ?? []);
  return Object.fromEntries(review.pages.filter((page) => !unread.has(page.sourceId))
    .map((page) => [page.pageId, { rev: page.rev, order: page.order, policyId: "", checkedAt: review.checkedAt }]));
}

const RETURN_REFRESH_MS = 60_000;
/** One frozen empty record, so "no canon" is the same object from read to read. */
const EMPTY_CANON: CanonTracking = emptyCanon();

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
  /** What the writer declared, a record per book. */
  private canonBooks: CanonBook[] = [];
  /** canon.json could not be read at all: nothing may replace it. */
  private canonUnreadable = false;
  private canonWrites: Promise<unknown> = Promise.resolve();
  /** One pen write at a time. Each of them queues its file write on `canonWrites`, so these are two queues. */
  private penWrites: Promise<unknown> = Promise.resolve();
  private trackingMemo: { canon: CanonTracking; world: WorldData | null; pages: unknown; review: ReviewOutcome | null; tracking: EngineTracking } | null = null;
  private recordMemo: { world: WorldEntity[] | null; tracking: CanonTracking; pages: unknown; entities: RecordEntity[] } | null = null;
  private readsMemo: { world: WorldData; policy: string; pages: unknown; complete: boolean } | null = null;
  private worldWrites: Promise<void> = Promise.resolve();
  private sceneWrites: Promise<unknown> = Promise.resolve();
  /** Bumped when what the panel is about changes hands: another account, deleted data, another book. Whatever a view holds for the old one goes. */
  scopeGeneration = 0;
  /** Bumped when the data here stops being what a running request was for: another account, or deleted data. A paid answer still arriving then goes nowhere near it. */
  dataEpoch = 0;
  /** Bumped when the local session ends: a review still finishing then keeps nothing. */
  private sessionGen = 0;
  private projected: { world: WorldData; review: ReviewOutcome; orderKey: string; entities: WorldEntity[] } | null = null;
  /** When the account was last re-read because the writer came back. */
  private returnedAt = 0;
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
      noteIds: {}, engineUrl: AUTH_CONFIG.engineUrl, devUid: "",
      installId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), ...NO_ACCOUNT_STATE, accountKey: null, rootAccount: null, otherAccounts: {}, dataFolder: DATA_FOLDER, ...rest,
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
    this.data.lastPlan = parseLastPlan(this.data.lastPlan);
    this.data.otherAccounts = parseOtherAccounts(this.data.otherAccounts);
    const key = (value: unknown): string | null => (typeof value === "string" && /^[0-9a-f]{24}$/u.test(value) ? value : null);
    this.data.accountKey = key(this.data.accountKey);
    this.data.rootAccount = key(this.data.rootAccount);
    // A vault's data.json can be synced or copied from elsewhere: never send a token to an address that is not ours to trust.
    if (!acceptableEngineUrl(this.data.engineUrl)) this.data.engineUrl = AUTH_CONFIG.engineUrl;
    this.data.dataFolder = dataFolderOf(this.data.dataFolder, this.app.vault.configDir);
    await this.save();
    this.world = await readWorld(this.app, this.accountFiles());
    await this.moveToVault();
    await this.loadCanon();
  }

  /** Canon and scenes kept in the plugin's folder by an earlier version move to the vault folder, once. */
  private async moveToVault(): Promise<void> {
    try {
      const { moved, kept } = await moveToVault(this.app, this.host.dir, this.data.dataFolder);
      if (kept > 0) new Notice(`Bunsho found canon or scenes in both the plugin's folder and the ${this.data.dataFolder} folder, with different text. Nothing was written over: the plugin folder's copies were left where they are.`);
      else if (moved > 0) new Notice(`Bunsho moved your canon and scenes to the ${this.data.dataFolder} folder in your vault, so uninstalling the plugin no longer removes them.`);
    } catch (error) {
      console.warn("[Bunsho] could not move canon and scenes to the vault", error);
    }
  }

  private async loadCanon(): Promise<void> {
    this.canonUnreadable = false;
    try {
      const { books, damaged, unreadable } = await readCanon(this.app, this.vaultFiles());
      this.canonBooks = books;
      this.canonUnreadable = unreadable;
      if (damaged) new Notice(`Bunsho could not read all of your canon. A copy of the file was kept as ${BROKEN} in the ${this.data.dataFolder} folder.`);
    } catch (error) {
      console.warn("[Bunsho] could not read canon", error);
      this.canonBooks = [];
      this.canonUnreadable = true;
    }
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
  /** Where the signed-in account's world.json is: a cache of what checks read, in the plugin's folder. */
  private accountFiles(): string { return accountDir(this.host.dir, this.data); }
  /** Where the signed-in account's canon and scenes are: the writer's own work, in the vault. */
  private vaultFiles(): string { return accountDir(this.data.dataFolder, this.data); }
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
    const canonMoves = this.canonBooks.some((book) => follow(book.source) !== book.source);
    const heldKeys = Object.keys(this.data.otherAccounts);
    const folder = followFolder(this.data.dataFolder, path, oldPath);
    if (folder !== this.data.dataFolder) {
      // The writer moved or renamed the Bunsho folder: it stays ours wherever it went, and the scenes are read from there.
      this.data.dataFolder = dataFolderOf(folder, this.app.vault.configDir);
      await this.save();
      this.host.changed();
    }
    const changes = canonMoves || heldKeys.length > 0 || holdsNoteId(this.data.noteIds, oldPath) || [this.data.source, this.reviewing, review?.source, stopped?.source].some((choice) => choice && follow(choice) !== choice);
    if (!changes) return;
    this.data.noteIds = moveNoteIds(this.data.noteIds, oldPath, path);
    if (this.data.source) this.data.source = follow(this.data.source);
    if (this.reviewing) this.reviewing = follow(this.reviewing);
    if (review) this.data.lastReview = { ...review, source: follow(review.source) };
    if (stopped) this.data.stopped = { ...stopped, source: follow(stopped.source) };
    this.data.otherAccounts = followHeld(this.data.otherAccounts, follow);
    await this.save();
    if (canonMoves) {
      this.canonBooks = this.canonBooks.map((book) => ({ ...book, source: follow(book.source) }));
      await this.saveCanon().catch((error: unknown) => { console.warn("[Bunsho] could not save canon after a move", error); });
    }
    // Their records follow too, or an account coming back would find its book gone.
    for (const key of heldKeys) await this.followHeldCanon(key, follow).catch((error: unknown) => { console.warn("[Bunsho] could not move a held canon", error); });
  }

  private async followHeldCanon(key: string, follow: (choice: SourceChoice) => SourceChoice): Promise<void> {
    const dir = accountDir(this.data.dataFolder, { accountKey: key, rootAccount: this.data.rootAccount });
    const { books, unreadable } = await readCanon(this.app, dir);
    if (unreadable || !books.some((book) => follow(book.source) !== book.source)) return;
    await writeCanon(this.app, dir, books.map((book) => ({ ...book, source: follow(book.source) })));
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
        await this.settleOwner();
        // Before the balance read, so a writer who has only ever used Obsidian starts with the starter credits.
        if (!this.starterClaimed) this.starterClaimed = await claimStarterCredits(this.connection());
        const transport = this.transport();
        const [health, { balance, opCosts }, project] = await Promise.all([
          new PipelineV3Client(transport).health(), readCredits(transport), readProjectState(transport, this.data.workspaceId),
        ]);
        if (project.plan?.active && project.plan.tier && (project.plan.tier !== this.data.lastPlan?.tier || project.plan.renewsAt !== this.data.lastPlan?.renewsAt)) {
          this.data.lastPlan = { tier: project.plan.tier, renewsAt: project.plan.renewsAt };
          await this.save();
        }
        next = { signedIn, health, balance, opCosts, tier: project.plan?.active ? project.plan.tier : null, planName: project.planName, problem: null, project: project.state, registeredName: project.registeredName, lapsed: lapsedPlan(project.plan, this.data.lastPlan) };
      } catch (error) {
        if (error instanceof AuthError && error.code === "signed_out") { this.endSession(); sessionOwnerStore(this.app).clear(); }
        next = error instanceof AuthError && error.code === "signed_out" ? { ...SIGNED_OUT, problem: error.message }
          : { ...next, planName: this.account.planName, balance: this.account.balance, opCosts: this.account.opCosts, tier: this.account.tier, lapsed: this.account.lapsed, problem: error instanceof PipelineV3Error || error instanceof AuthError ? error.message : "Could not reach Bunsho. Check your connection." };
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

  /** The writer came back to Obsidian, perhaps from buying credits in the browser. At most once a minute, and never mid-check. */
  async returned(now = Date.now()): Promise<void> {
    if (!this.account.signedIn || this.busy || now - this.returnedAt < RETURN_REFRESH_MS) return;
    this.returnedAt = now;
    await this.refreshAccount();
  }

  /** A draft in the writer's own mail app; the address is in the notice too, in case there is no mail app to open. */
  contactSupport(): void {
    new Notice(`Opening an email to ${SUPPORT_EMAIL} in your mail app.`);
    window.open(supportMailto(this.host.version), "_external");
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
      this.endSession();
      sessionOwnerStore(this.app).clear();
    }
    await this.refreshAccount();
  }

  /**
   * A session ending stops a running check and keeps everything else: the writer who signs back in wants their findings, World
   * and canon where they left them (founder, 5 November 2026). "Delete my Bunsho data" is how they remove it.
   */
  private endSession(): void {
    this.sessionGen++;
    this.abort?.abort();
  }

  /**
   * A different account signing in on this vault sees nothing of the last one's, and sends nothing of it: reads and pins are that
   * account's to send. Its data is kept for when it returns. Runs before anything the panel shows or the engine is told.
   */
  private async settleOwner(): Promise<void> {
    const key = await this.sessionKey();
    if (!key) return;
    const { next, changed, swapped } = settleAccount(this.data, key);
    if (!changed) return;
    this.data = next;
    if (swapped) {
      this.starterClaimed = false;
      this.scopeGeneration++;
      this.dataEpoch++;
      if (this.phase.kind === "error") this.phase = { kind: "idle" };
      this.projected = null;
      this.recordMemo = null;
      this.world = await readWorld(this.app, this.accountFiles());
      await this.loadCanon();
    }
    await this.save();
    if (swapped) await this.refreshScan();
  }

  /**
   * Whose session this is. Read from the token when it can be, and remembered beside it, so a writer offline still sees their own
   * data, and a synced data.json naming someone else never shows them that person's. A session it cannot name at all is told apart
   * from a passing failure by what is remembered.
   */
  private async sessionKey(): Promise<string | null> {
    if (this.devUid) return accountKey(this.devUid);
    const owner = sessionOwnerStore(this.app);
    try {
      const uid = uidOfToken(await this.tokens.idToken());
      if (uid) { const key = accountKey(uid); owner.set(key); return key; }
    } catch (error) {
      if (error instanceof AuthError && error.code === "signed_out") throw error;
      const known = owner.get();
      if (known) return known;
      throw error;
    }
    return owner.get();
  }

  /** Other accounts have left data on this vault: the delete's confirm says it goes too. */
  holdsOtherAccounts(): boolean { return Object.keys(this.data.otherAccounts).length > 0 || this.data.rootAccount !== this.data.accountKey; }

  /**
   * "Delete my Bunsho data": findings and decisions, the World, canon, the reading plan and what was picked to read, for every
   * account that left data here. A running check stops first. The notes, the sign-in and the install are not touched.
   */
  async deleteData(): Promise<void> {
    this.sessionGen++;
    this.abort?.abort();
    this.world = null;
    this.projected = null;
    this.canonBooks = [];
    this.canonUnreadable = false;
    this.recordMemo = null;
    this.scopeGeneration++;
    this.dataEpoch++;
    const dir = this.host.dir;
    const folder = this.data.dataFolder;
    Object.assign(this.data, NO_ACCOUNT_STATE, { noteIds: {}, accountKey: null, rootAccount: null, otherAccounts: {} });
    this.scan = { status: "no_source" };
    this.phase = { kind: "idle" };
    this.host.changed();
    await Promise.all([this.worldWrites, this.sceneWrites.catch(() => undefined), this.penWrites.catch(() => undefined), this.canonWrites.catch(() => undefined)]);
    await removeWorld(this.app, dir);
    // Canon and scenes from an earlier version that could not be moved are the writer's too.
    for (const place of [dir, folder]) { await removeCanon(this.app, place); await removeScenes(this.app, place); }
    const { adapter } = this.app.vault;
    if (await adapter.exists(`${dir}/accounts`)) await adapter.rmdir(`${dir}/accounts`, true);
    if (await adapter.exists(`${folder}/accounts`)) {
      for (const held of (await adapter.list(`${folder}/accounts`)).folders) { await removeCanon(this.app, held); await removeScenes(this.app, held); }
    }
    await removeIfEmpty(this.app, folder);
    await this.save();
    await this.refresh();
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
    if (this.canonUnreadable) return CANON_UNREADABLE;
    if (this.pins().length > MAX_PINS) return this.tooManyPins();
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
      if (!same) { this.data.plan = null; this.scopeGeneration++; }
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
      const session = this.sessionGen;
      const issue = review.issues.find((i) => i.issue_id === issueId);
      const revs = new Map(scan.pages.map((page) => [page.pageId, page.rev]));
      const edited = issue?.citations.some((citation) => revs.get(citation.page_id) !== citation.source_ref?.rev) ?? false;
      const pinsBefore = writerPinDigest(this.canonTracking());
      const held = this.pinStillSent(issue);

      const done = await this.execute(scan.items, scan.source, health, quoted, scope, "check");
      if (done.kind === "ended") { this.idle(); return { kind: "none", message: "" }; }
      if (done.kind === "failed") {
        this.idle();
        await this.refreshAccount();
        return incomplete(done.error instanceof Error ? done.error.message : "The check failed.");
      }
      const { run, merged, scan: after } = done;
      const proven = merged.failed.length === 0 && !merged.incomplete && !merged.stale && !run.capped && run.lostFindings === 0
        && after?.status === "ready" && after.snapshotId === run.snapshotId && !merged.survivors.has(issueId) && edited && held
        // The writer's declarations are part of what a check is against: pins that moved prove nothing about this card.
        && writerPinDigest(this.canonTracking()) === pinsBefore && await this.policyStands(health);
      if (session !== this.sessionGen) { this.idle(); return { kind: "none", message: "" }; } // signed out during that last question
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

  /** A canon card can only be proved gone by a check that carried its pin. Any other card has no pin to carry. */
  private pinStillSent(issue: EngineIssue | undefined): boolean {
    if (issue?.type !== CANON_CONFLICT_ISSUE_TYPE) return true;
    const view = this.canonConflict(issue);
    if (!view) return false;
    const { pinnedStateId, entityId, dimension, pinnedValue } = view.context;
    return this.pins().some((pin) => pin.pinId === pinnedStateId && pin.entityId === entityId && pin.dimension === dimension && pin.value === pinnedValue);
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
    if (this.canonUnreadable) return CANON_UNREADABLE;
    if (this.pins().length > MAX_PINS) return this.tooManyPins();
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
    const saved = await this.persist(done.merged, done.run, items, scope, credits);
    // A whole-book review that finished checked every pin it carried, which may be fewer than there are now.
    if (saved && !scope && !done.merged.incomplete && !done.merged.stale && !done.run.capped && done.run.lostFindings === 0) await this.recordCanonChecked(done.merged.review.source, done.pinDigest);
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
    const tracking = this.canonTracking();
    const pinDigest = writerPinDigest(tracking);
    this.setPhase({ kind: "checking", share: 0, waiting: true });
    try {
      let run: ReviewRun;
      try {
        run = await runReview({
          items, source, health, workspaceId: this.data.workspaceId, client: new PipelineV3Client(this.transport()), scope,
          known: world ? { reads: world.reads, cast: world.cast, fromFullReview: world.fromFullReview } : undefined,
          maxCredits: credits ?? undefined, signal: abort.signal, pins: writerPins(tracking),
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
        statusOf: (id) => this.statusOf(id), items, texts: run.texts, activePins: this.pins(),
      });
      // Reads streamed under a read policy other than the one they were filed under cannot be sent back.
      const sameReadPolicy = run.readPolicyId === health.readPolicyId;
      const kept: KeptRead[] = [...(sameReadPolicy ? world?.reads ?? [] : forgetCached(world?.reads ?? [])), ...fresh.map((read) => ({ readPolicyId: sameReadPolicy ? health.readPolicyId : null, read }))];
      await this.setWorld({
        // Paid for, whatever the scan after it managed to read: what was sent stays known.
        reads: pruneReads(kept, merged.review.ledger, new Set([...current.keys(), ...sent])),
        cast: mergeCast(world?.cast ?? [], run.cast, scope ? "chapters" : "full"),
        fromFullReview: scope ? world?.fromFullReview ?? false : true,
      });
      if (session !== this.sessionGen) return { kind: "ended" }; // signed out while the World was being kept
      return { kind: "merged", run, merged, scan: now, pinDigest };
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
    // Check canon marks nothing checked, so it says nothing about chapters. A cancelled one the engine did not charge leaves nothing to say.
    if (action.kind === "canon" && error instanceof PipelineV3Error && (error.code === "cancelled" || error.code === "insufficient_credits")) {
      if (error.code === "cancelled" && error.detail.charged === false) this.idle();
      else this.setPhase({ kind: "error", message: error.message, charged: error.code === "cancelled", action });
      await this.refreshAccount();
      return;
    }
    if (error instanceof PipelineV3Error && error.code === "cancelled") {
      // A review the engine says it did not charge leaves nothing to say. An unknown charge is not a free one.
      if (error.detail.charged !== false) await stop({ status: "partial", source, checked: 0, failed: total, total, message: error.message, credits });
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
    // A chapter check whose reads the engine refused has no book to compare against: the whole-book check is the way back.
    const canRetry = !(error instanceof PipelineV3Error && (error.code === "too_large" || (error.code === "invalid_request" && action.kind !== "full")));
    this.setPhase({ kind: "error", message: error instanceof Error ? error.message : "The check failed.", charged, ...(canRetry ? { action } : {}) });
    await this.refreshAccount();
  }

  /** The Director's writes wait in line with the delete, as this controller's own do. */
  trackSceneWrite<T>(write: Promise<T>): Promise<T> { this.sceneWrites = this.sceneWrites.catch(() => undefined).then(() => write); return write; }

  /** Where the signed-in account's own files are. */
  /** Where this account's scenes are, in the vault. */
  accountFolder(): string { return this.vaultFiles(); }
  connectionOptions(): ConnectionOptions { return this.connection(); }
  /** The notes as they are now. Throws when one cannot be read. */
  readScan(): Promise<Scan> { return this.freshScan(); }
  /** The note a note id is at now, by id, so a rename is followed. */
  pathOfNote(noteId: string): string | null { return Object.entries(this.data.noteIds).find(([, id]) => id === noteId)?.[0] ?? null; }

  /** The plan item under the writer's cursor. Only a line on the plan: a scene goes into the book. */
  activeChapter(): PlannedItem | null {
    const { scan } = this;
    if (scan.status !== "ready") return null;
    const position = activeNotePosition(this.app);
    const noteId = position ? this.data.noteIds[position.path] : undefined;
    return position && noteId ? itemAtOffset(scan.items, noteId, position.offset) : null;
  }

  /** What Check chapter costs for this line of the plan, when it can run. */
  chapterQuote(itemId: string): number | null {
    const { scan } = this;
    if (!this.chapterChecksOpen() || scan.status !== "ready" || !scan.items.some((item) => item.id === itemId && item.included)) return null;
    return this.priceFor(scan.itemChars[itemId] ?? 0, this.account.health);
  }

  /**
   * What a Director request carries: what the writer declared, with what the checks of this book read projected over it. Built when asked and never stored, so canon.json stays the
   * writer's alone, and a book with neither is still a complete bundle.
   */
  directorTracking(): EngineTracking {
    const canon = this.canonTracking();
    const { world, scan } = this;
    const pages = scan.status === "ready" ? scan.pages : null;
    const review = this.currentReview();
    if (this.trackingMemo?.canon === canon && this.trackingMemo.world === world && this.trackingMemo.pages === pages && this.trackingMemo.review === review) return this.trackingMemo.tracking;
    const seed = seedTracking(canon);
    const order = new Map(pages?.map((page) => [page.pageId, page.order]));
    const reads = world && review ? worldReads(world.reads, review.ledger).filter((read) => order.has(read.pageId)) : [];
    const tracking = world && reads.length > 0 ? projectPipelineV3World({ tracking: seed, cast: world.cast, reads, pageOrder: order }) : seed;
    this.trackingMemo = { canon, world, pages, review, tracking };
    return tracking;
  }

  /** Who the direction box's @ list offers. */
  directorCast(): DirectorCastMember[] { return rankCast(this.directorTracking().entities.entities); }

  /** The review that failed, at what it costs now. Null when it no longer can run. */
  retryQuote(): number | null {
    const { phase, scan } = this;
    if (phase.kind !== "error" || !phase.action || scan.status !== "ready") return null;
    if (phase.action.kind === "full") return this.price();
    if (phase.action.kind === "changes") return this.changedChapters()?.credits ?? null;
    if (phase.action.kind === "canon") return this.canonOffer()?.credits ?? null;
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
    if (action.kind === "canon") return this.checkCanon(quoted);
    return this.checkChapter(action.itemId, quoted);
  }

  /** Jump to issue. Free and local. */
  pickIssue(open: readonly EngineIssue[], coordinate: (issue: EngineIssue) => string): Promise<EngineIssue | null> { return this.host.pickIssue(open, coordinate); }

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
    const dir = this.accountFiles();
    const write = this.worldWrites.then(async () => {
      if (world) await writeWorld(this.app, dir, world);
      else await removeWorld(this.app, dir);
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
      // A chapter moved since the check: a read keeps the order it was read at, and a change must not read backwards.
      const pages = this.scan.status === "ready" ? this.scan.pages : review.pages;
      const orderKey = pages.map((page) => page.pageId).join("\u0000");
      if (this.projected?.world === world && this.projected.review === review && this.projected.orderKey === orderKey) return this.projected.entities;
      const reads = worldReads(world.reads, review.ledger);
      if (reads.length === 0) return null;
      const placement = { order: new Map(pages.map((page) => [page.pageId, page.order])), chapter: new Map(review.pages.map((page) => [page.pageId, page.sourceId])) };
      this.projected = { world, review, orderKey, entities: projectWorld(world.cast, reads, placement) };
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

  private currentBook(): CanonBook | null {
    const { source } = this.data;
    return source ? this.canonBooks.find((book) => book.source.kind === source.kind && book.source.path === source.path) ?? null : null;
  }

  /** What the writer declared for the book picked now. */
  canonTracking(): CanonTracking { return this.currentBook()?.tracking ?? EMPTY_CANON; }

  /** The active pins of the book picked now. */
  private pins() { return writerPins(this.canonTracking()); }

  private tooManyPins(): string { return `Bunsho can check up to ${MAX_PINS} declared facts at a time, and you have ${formatNumber(this.pins().length)}. Revert some, then try again. You were not charged.`; }

  private saveCanon(): Promise<void> {
    if (this.canonUnreadable) return Promise.reject(new Error("canon.json could not be read"));
    const dir = this.vaultFiles();
    const books = this.canonBooks;
    const write = this.canonWrites.catch(() => undefined).then(() => writeCanon(this.app, dir, books));
    this.canonWrites = write;
    return write;
  }

  /** canon.json could not be read, in the writer's words. */
  get canonProblem(): string | null { return this.canonUnreadable ? CANON_UNREADABLE : null; }

  /** The pen rests while a plan has lapsed: everything declared still reads. */
  get penOpen(): boolean { return this.account.lapsed === null && !this.canonUnreadable; }

  /** The World, what checks found with what the writer declared over it. Empty when neither has anything to say. */
  worldRecord(): RecordEntity[] {
    const world = this.worldEntities();
    const tracking = this.canonTracking();
    const pages = this.currentReview()?.pages ?? null;
    if (this.recordMemo?.world === world && this.recordMemo.tracking === tracking && this.recordMemo.pages === pages) return this.recordMemo.entities;
    const entities = mergeRecord(world ?? [], tracking, (pageId) => this.pageLabel(pageId));
    this.recordMemo = { world, tracking, pages, entities };
    return entities;
  }

  private pageLabel(pageId: string): string | null { return this.currentReview()?.pages.find((page) => page.pageId === pageId)?.label ?? null; }

  /** One pen write at a time, each on the record the last one left. The record is only replaced once it is on disk. */
  private penWrite<T>(apply: (tracking: CanonTracking, context: PenContext) => PenResult<T>): Promise<PenResult<T>> {
    const failed = (): PenResult<T> => ({ success: false, code: "INTERNAL_ERROR", error: "That could not be saved." });
    const run = async (): Promise<PenResult<T>> => {
      const { source } = this.data;
      if (!source || !this.penOpen) return failed();
      const book = this.currentBook();
      const tracking = book?.tracking ?? emptyCanon();
      const result = apply(tracking, { now: new Date().toISOString(), found: foundEntities(this.worldEntities() ?? [], tracking) });
      if (!result.success || !result.changed) return result;
      const written: CanonBook = book ? { ...book, tracking: result.tracking } : { source, tracking: result.tracking, checked: null };
      this.canonBooks = book ? this.canonBooks.map((b) => (b === book ? written : b)) : [...this.canonBooks, written];
      try {
        await this.saveCanon();
      } catch (error) {
        console.warn("[Bunsho] could not save canon", error);
        // Only this write goes back: anything else that happened meanwhile stands.
        this.canonBooks = book ? this.canonBooks.map((b) => (b === written ? book : b)) : this.canonBooks.filter((b) => b !== written);
        return failed();
      }
      // A Free account's story record lives in its one project: its first declaration makes this vault that project, as a first check does.
      if (this.account.project === "unregistered") {
        try {
          await registerProject(this.connection(), this.data.workspaceId, this.projectName());
          this.account = { ...this.account, project: "ok" };
        } catch (error) { console.warn("[Bunsho] could not register this project", error); }
      }
      this.host.changed();
      return result;
    };
    const write = this.penWrites.catch(() => undefined).then(run);
    this.penWrites = write;
    return write;
  }

  private refOf(entityId: string): EntityRef | null { return this.worldRecord().find((entity) => entity.id === entityId)?.ref ?? null; }

  /** "Make canon" on a found row, found afresh: a row that has gone since it was shown is refused, never pinned by id alone. */
  makeCanon(entityId: string, rowId: string): Promise<PenResult<{ id: string; declaredAt: string }>> {
    return this.penWrite((tracking, context) => {
      const stale: PenResult<{ id: string; declaredAt: string }> = { success: false, code: "STALE_TARGET", error: "That fact changed since it was shown — reloading" };
      const entity = this.worldRecord().find((e) => e.id === entityId);
      const row = entity?.rows.find((r) => r.id === rowId)?.found;
      if (!entity || !row) return stale;
      const from = { pageId: row.pageId, pageOrder: row.order, rev: row.rev, quote: row.quote };
      const counterpart = row.counterpart ? this.refOf(row.counterpart) : undefined;
      if (row.counterpart && !counterpart) return stale;
      const fact: FoundFact = row.polarity ? { kind: "knowledge", polarity: row.polarity, proposition: row.value, from }
        : { kind: "state", dimension: row.family ?? capKey(row.dimension, MAX_DIMENSION_CHARS), value: row.value, stability: row.stability, ...(counterpart ? { counterpart } : {}), from };
      return pinFound(tracking, context, { entity: entity.ref, fact });
    });
  }

  revertFact(target: CanonTarget): Promise<PenResult<{ outcome: "restored" | "removed" }>> { return this.penWrite((tracking, context) => unpinFact(tracking, context, target)); }
  removeFact(target: CanonTarget): Promise<PenResult<{ outcome: "restored" | "removed" }>> { return this.penWrite((tracking, context) => removeFact(tracking, context, target)); }
  editFact(target: CanonTarget, patch: FactPatch): Promise<PenResult<{ declaredAt: string; changed: boolean }>> { return this.penWrite((tracking, context) => editFact(tracking, context, target, patch)); }

  addAlias(entityId: string, text: string, resolution?: IdentityResolution, matched?: EntityRef): Promise<PenResult<{ entityId: string; added: boolean }>> {
    return this.penWrite((tracking, context) => {
      const entity = this.refOf(entityId);
      return entity ? addAlias(tracking, context, { entity, text, resolution, matched }) : { success: false, code: "NOT_FOUND", error: "That entity is no longer in the record" };
    });
  }

  addEntity(canonicalName: string, type: string, aliases: readonly string[], resolution?: IdentityResolution, matched?: EntityRef): Promise<PenResult<AddEntityOutcome>> {
    return this.penWrite((tracking, context) => addEntity(tracking, context, { canonicalName, type, aliases, resolution, matched }));
  }

  renameEntity(entityId: string, canonicalName: string, resolution?: IdentityResolution): Promise<PenResult<{ entityId: string; canonicalName: string; outcome: "renamed" | "unchanged" }>> {
    return this.penWrite((tracking, context) => {
      const entity = this.refOf(entityId);
      return entity ? renameEntity(tracking, context, { entity, canonicalName, resolution }) : { success: false, code: "NOT_FOUND", error: "That entity is no longer in the record" };
    });
  }

  removeEntity(entityId: string): Promise<PenResult<{ entityId: string; removedStates: number; removedKnowledge: number }>> {
    return this.penWrite((tracking, context) => removeEntity(tracking, context, entityId));
  }

  /**
   * "Add a fact". `key` is a vocabulary key. A relationship's or possession's `detail` is a card's id, a stance's the topic as typed.
   * Typing what a check already found pins it, keeping its page.
   */
  addFact(entityId: string, key: string, detail: string | null, value: string): Promise<PenResult<{ kind: "state" | "knowledge"; id: string; outcome: "created" | "pinned" | "unchanged" }>> {
    return this.penWrite((tracking, context) => {
      const entity = this.worldRecord().find((e) => e.id === entityId);
      if (!entity) return { success: false, code: "NOT_FOUND", error: "That entity is no longer in the record" };
      const entry = dimensionEntry(key);
      const sameValue = (text: string): boolean => nfcKey(text) === nfcKey(value);
      const foundRow = (test: (row: WorldRow) => boolean): WorldRow | undefined => entity.rows.flatMap((r) => (r.found ? [r.found] : [])).find((row) => test(row) && sameValue(row.value));
      const page = (row: WorldRow | undefined) => (row ? { from: { pageId: row.pageId, pageOrder: row.order, rev: row.rev, quote: row.quote } } : {});
      let fact: HandFact;
      if (entry?.kind === "knowledge") fact = { kind: "knowledge", polarity: key, proposition: value, ...page(foundRow((row) => row.polarity === key)) };
      else if (entry?.param === "entity") {
        const counterpart = detail ? this.refOf(detail) : null;
        if (!counterpart) return { success: false, code: "INVALID_INPUT", error: "That dimension names an entity that is not in the record" };
        fact = { kind: "state", dimension: key, value, counterpart, ...page(foundRow((row) => row.family === key && row.counterpart === detail)) };
      } else if (entry?.param === "topic") {
        const dimension = `${key}:${detail ?? ""}`;
        fact = { kind: "state", dimension, value, ...page(foundRow((row) => nfcKey(row.dimension) === nfcKey(dimension.replace(/\s+/gu, "_")))) };
      } else fact = { kind: "state", dimension: key, value, ...page(foundRow((row) => row.dimension === key)) };
      return addFact(tracking, context, { entity: entity.ref, fact });
    });
  }

  /** A canon finding as its card reads it, or null when it should read as an ordinary finding. */
  canonConflict(issue: EngineIssue): CanonConflictView | null {
    const review = this.currentReview();
    const place = new Map(review?.coverage.sources.map((source, at) => [source.id, at + 1]));
    const pages = new Map(review?.pages.map((page) => [page.pageId, page.sourceId]));
    return buildCanonConflictView(issue, this.canonTracking(), (pageId, order) => place.get(pages.get(pageId) ?? "") ?? order + 1, (pageId) => this.pageLabel(pageId));
  }

  /**
   * The Check canon offer: the canon changed since the whole book was last checked against it, every chapter's read stands, and the
   * price is known. Canon is checked free in every review; this is for when it changed in between.
   */
  canonOffer(): { pins: number; credits: number } | null {
    const { scan, world } = this;
    const { health } = this.account;
    const book = this.currentBook();
    if (!book || !world || !health || !this.chapterChecksOpen() || scan.status !== "ready") return null;
    const pins = writerPins(book.tracking);
    if (pins.length === 0 || pins.length > MAX_PINS || book.checked?.pinDigest === writerPinDigest(book.tracking)) return null;
    if (this.readsMemo?.world !== world || this.readsMemo.policy !== health.readPolicyId || this.readsMemo.pages !== scan.pages) {
      this.readsMemo = { world, policy: health.readPolicyId, pages: scan.pages, complete: usableReads(world.reads, health.readPolicyId, scan.pages).length === scan.pages.length };
    }
    if (!this.readsMemo.complete) return null;
    const credits = canonCredits(health, scan.chars, pins.length);
    return credits === null ? null : { pins: pins.length, credits };
  }

  private async recordCanonChecked(source: SourceChoice, pinDigest: string): Promise<void> {
    const book = this.currentBook();
    if (!book || book.source.kind !== source.kind || book.source.path !== source.path) return;
    this.canonBooks = this.canonBooks.map((b) => (b === book ? { ...b, checked: { pinDigest, checkedAt: new Date().toISOString() } } : b));
    await this.saveCanon().catch((error: unknown) => { console.warn("[Bunsho] could not record the canon check", error); });
  }

  /** Check canon, at the price on its button. Stores or retires canon findings alone: nothing is marked checked, and the cast stays. */
  async checkCanon(quoted: number): Promise<void> {
    if (this.busy) return;
    this.setPhase({ kind: "preparing" });
    try {
      const prepared = await this.prepareScoped(quoted, (scan) => scan.items.filter((item) => item.included).map((item) => item.id));
      if (prepared.kind === "quiet") return this.idle();
      if (prepared.kind === "refused") return this.fail(prepared.message);
      const { scan, health, review } = prepared;
      const tracking = this.canonTracking();
      const pins = writerPins(tracking);
      if (pins.length === 0 || !this.world) return this.idle();
      const pinDigest = writerPinDigest(tracking);
      const source = scan.source;
      const abort = new AbortController();
      this.abort = abort;
      this.reviewing = source;
      const session = this.sessionGen;
      const tracker = new ProgressTracker();
      this.setPhase({ kind: "checking", share: 0, waiting: true });
      try {
        const run = await runCanonReview({ items: scan.items, health, workspaceId: this.data.workspaceId, client: new PipelineV3Client(this.transport()), pins, reads: this.world.reads, maxCredits: quoted, signal: abort.signal,
          callbacks: { onProgress: (p) => this.setPhase({ kind: "checking", share: tracker.update(p), waiting: false, stage: p.stage }) } });
        if (session !== this.sessionGen) return this.idle();
        if (run.kind === "unread") return this.fail(CANON_UNREAD_MESSAGE, false);
        let now: Scan | null = null;
        try { now = await this.freshScan(); } catch (error) { console.warn("[Bunsho] could not read the notes after a canon check", error); }
        if (session !== this.sessionGen) return this.idle();
        const current = new Map(now?.status === "ready" ? now.pages.map((page) => [page.pageId, page]) : []);
        const edited = new Set(run.pages.filter((page) => { const moved = current.get(page.pageId); return !moved || moved.rev !== page.rev || moved.order !== page.order; }).map((page) => page.pageId));
        // The review as it stands: the writer may have renamed the folder while this ran.
        const merged = mergeCanonPass({ prior: this.currentReview() ?? review, issues: run.issues, edited, whole: !run.capped && !run.skipped && run.lostFindings === 0, statusOf: (id) => this.statusOf(id), texts: run.texts, pages: run.pages });
        const reopened = new Set(merged.reopened);
        this.data.fixed = this.data.fixed.filter((id) => !reopened.has(id));
        this.data.lastReview = merged.review;
        let saved = true;
        try { await this.save(); } catch (error) { saved = false; console.warn("[Bunsho] could not save the canon findings", error); }
        if (saved && merged.complete) await this.recordCanonChecked(merged.review.source, pinDigest);
        const message = saved ? merged.message : CANON_SAVE_MESSAGE;
        if (message) this.setPhase({ kind: "error", message, charged: true, action: { kind: "canon" } });
        else this.idle();
        await this.refreshAccount();
      } catch (error) {
        if (session !== this.sessionGen) return this.idle();
        return await this.reviewFailed(error, { kind: "canon" }, source, 0, quoted);
      } finally {
        if (this.abort === abort) this.abort = null;
        this.reviewing = null;
      }
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "The canon check failed.");
    }
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
