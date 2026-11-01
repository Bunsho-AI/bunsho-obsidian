/**
 * The plugin's state and actions (the atomic structure's "hooks" layer for a non-React app): manuscript scan, account,
 * check lifecycle, findings. Pages read its state and call its actions; components below pages receive plain props.
 */
import { Notice, type App } from "obsidian";
import { buildChapters, chapterProblems, DEFAULT_MANUSCRIPT_FOLDER, isChapterPath, normalizeFolder, roughWords, snapshotId, type Chapter } from "@/helpers/chapters";
import { ProgressTracker } from "@/helpers/progress";
import type { EngineIssueCitation } from "@/lib/contract/engine.types";
import { PipelineV3Client, PipelineV3Error } from "@/lib/contract/pipelineV3Client";
import { PIPELINE_V3_PRICE_OP, type PipelineV3Health } from "@/lib/contract/pipelineV3.types";
import { pipelineV3ReviewCredits } from "@/lib/contract/pipelineV3Pricing";
import { selectPassage } from "@/lib/obsidian/editor";
import { secretSessionStore } from "@/lib/obsidian/secretStore";
import { readManuscriptNotes } from "@/lib/obsidian/vault";
import { AUTH_CONFIG } from "@/lib/services/auth/authConfig";
import { AuthError, TokenSource } from "@/lib/services/auth/authService";
import { claimStarterCredits, formPost, makeTransport, readBalance, type ConnectionOptions } from "@/lib/services/engine/engineService";
import { readProjectState, registerProject } from "@/lib/services/project/projectService";
import { runReview, type ReviewOutcome } from "@/lib/services/review/reviewService";
import { SIGNED_OUT, type Account, type Phase, type PluginData, type Scan } from "@/types";
import { formatNumber } from "@/utils/format";
import { acceptableEngineUrl, isLocalEngine } from "@/utils/url";

const SCAN_DEBOUNCE_MS = 1500;

export interface CheckQuote { chapters: number; words: number; credits: number | null; balance: number | null }

/** What the controller needs from the plugin it lives in. */
export interface ControllerHost {
  app: App;
  version: string;
  loadData(): Promise<unknown>;
  saveData(data: PluginData): Promise<void>;
  openPanel(): Promise<void>;
  /** Shows the price confirmation; resolves true only on an explicit "Check". */
  confirmCheck(quote: CheckQuote): Promise<boolean>;
  /** Re-render whatever shows the state. */
  changed(): void;
}

export class ContinuityController {
  data!: PluginData;
  scan: Scan = { status: "no_folder" };
  phase: Phase = { kind: "idle" };
  account: Account = SIGNED_OUT;
  private tokens!: TokenSource;
  private abort: AbortController | null = null;
  private scanTimer: number | undefined;
  private scanSeq = 0;
  private accountSeq = 0;
  private starterClaimed = false; // once per session; the engine itself grants the starter credits only once per account

  constructor(private readonly host: ControllerHost) {}

  async load(): Promise<void> {
    const saved = (await this.host.loadData()) as Partial<PluginData> | null;
    this.data = {
      manuscriptFolder: DEFAULT_MANUSCRIPT_FOLDER, engineUrl: AUTH_CONFIG.engineUrl, devUid: "",
      installId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), dismissed: [], lastReview: null, ...saved,
    };
    // A vault's data.json can be synced or copied from elsewhere: never send a token to an address that is not ours to trust.
    if (!acceptableEngineUrl(this.data.engineUrl)) this.data.engineUrl = AUTH_CONFIG.engineUrl;
    this.tokens = new TokenSource(formPost, secretSessionStore(this.host.app));
    await this.save();
  }

  dispose(): void {
    window.clearTimeout(this.scanTimer);
    this.abort?.abort();
  }

  async save(): Promise<void> { await this.host.saveData(this.data); }

  private get app(): App { return this.host.app; }
  private get folder(): string { return normalizeFolder(this.data.manuscriptFolder); }
  private get devUid(): string | undefined { return isLocalEngine(this.data.engineUrl) && this.data.devUid ? this.data.devUid : undefined; }

  private connection(): ConnectionOptions {
    return { baseUrl: this.data.engineUrl, tokens: this.tokens, installId: this.data.installId, version: this.host.version,
      devUid: this.devUid, logger: { warn: (m, x) => console.warn(`[Bunsho] ${m}`, x), info: () => undefined } };
  }

  private transport() { return makeTransport(this.connection()); }

  isChapter(path: string): boolean { return isChapterPath(path, this.folder); }

  /** Whether a vault change can affect the manuscript (and so needs a rescan). */
  touchesManuscript(path: string, oldPath?: string): boolean {
    return this.isChapter(path) || (oldPath !== undefined && this.isChapter(oldPath)) || path === this.folder;
  }

  /** The last review, when it is about this manuscript folder (the setting may have changed since). */
  currentReview(): ReviewOutcome | null {
    const review = this.data.lastReview;
    return review && review.chapters.every((c) => this.isChapter(c.pageId)) ? review : null;
  }

  async refresh(): Promise<void> {
    await Promise.all([this.refreshScan(), this.refreshAccount()]);
  }

  scheduleScan(): void {
    window.clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => void this.refreshScan(), SCAN_DEBOUNCE_MS);
  }

  async refreshScan(): Promise<void> {
    window.clearTimeout(this.scanTimer);
    const seq = ++this.scanSeq;
    const notes = await readManuscriptNotes(this.app, this.folder);
    let next: Scan;
    if (!notes) next = { status: "no_folder" };
    else {
      const { chapters, skipped } = buildChapters(notes);
      next = chapters.length === 0 ? { status: "no_notes" } : {
        status: "ready", chapters, skipped, snapshotId: snapshotId(chapters),
        chars: chapters.reduce((n, c) => n + c.text.length, 0), words: chapters.reduce((n, c) => n + roughWords(c.text), 0),
      };
    }
    if (seq !== this.scanSeq) return; // a newer scan started while this one read notes
    this.scan = next;
    this.host.changed();
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
  price(): number | null {
    const { health } = this.account;
    if (!health || this.scan.status !== "ready") return null;
    return pipelineV3ReviewCredits({ op: PIPELINE_V3_PRICE_OP, creditsPerThousandChars: health.pricing.creditsPerThousandChars, minimumUnits: health.pricing.minimumUnits }, this.scan.chars);
  }

  async signIn(): Promise<void> {
    try {
      await this.tokens.signIn((url) => window.open(url));
      new Notice("Signed in to Bunsho.");
    } catch (error) {
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
    await this.refreshAccount();
  }

  /**
   * Check the whole manuscript. Reads the notes and the engine's price fresh, shows the price and asks before anything is
   * spent (from the panel and from the command palette alike), and runs at most one review at a time.
   */
  async check(): Promise<void> {
    if (this.phase.kind !== "idle" && this.phase.kind !== "error") return;
    this.setPhase({ kind: "preparing" });
    try {
      await Promise.all([this.refreshScan(), this.refreshAccount()]);
      const { scan, account } = this;
      if (!account.signedIn) { new Notice(account.problem ?? "Sign in to Bunsho to check your manuscript."); await this.host.openPanel(); return this.idle(); }
      if (scan.status !== "ready") { new Notice("Bunsho: no chapters found. See the panel for the folder layout."); await this.host.openPanel(); return this.idle(); }
      if (!account.health) {
        if (account.problem) new Notice(account.problem);
        await this.host.openPanel();
        return this.idle();
      }
      if (account.project === "blocked") return this.idle(); // the panel explains the free plan's one project
      const problems = chapterProblems(scan.chapters);
      if (problems.length > 0) return this.fail(problems[0]);
      const credits = this.price();
      if (credits !== null && account.balance !== null && account.balance < credits) {
        return this.fail(`This check costs about ${formatNumber(credits)} credits and you have ${formatNumber(account.balance)}. Add credits in Bunsho, then try again.`);
      }
      this.setPhase({ kind: "confirming" });
      const confirmed = await this.host.confirmCheck({ chapters: scan.chapters.length, words: scan.words, credits, balance: account.balance });
      if (!confirmed) return this.idle();
      // The free plan's one project becomes this manuscript, on the writer's first confirmed check.
      if (account.project === "unregistered") await registerProject(this.connection(), this.data.workspaceId, this.projectName());
      await this.runConfirmed(scan.chapters, account.health, credits);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "The check failed.");
    }
  }

  private async runConfirmed(chapters: Chapter[], health: PipelineV3Health, credits: number | null): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    const tracker = new ProgressTracker();
    this.setPhase({ kind: "checking", share: 0, waiting: true });
    try {
      const outcome = await runReview({
        chapters, health, workspaceId: this.data.workspaceId, client: new PipelineV3Client(this.transport()),
        maxCredits: credits ?? undefined, signal: abort.signal,
        callbacks: { onProgress: (p) => this.setPhase({ kind: "checking", share: tracker.update(p), waiting: false, stage: p.stage }) },
      });
      this.data.lastReview = outcome;
      await this.save();
      this.idle();
      await this.refreshAccount();
    } catch (error) {
      if (error instanceof PipelineV3Error && error.code === "cancelled") this.idle();
      else this.fail(error instanceof Error ? error.message : "The check failed.", error instanceof PipelineV3Error ? error.detail.charged : undefined);
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  /** How the free project is named on every surface ("Your free project is …"): the vault, and the folder when it is not the default. */
  private projectName(): string {
    const vault = this.app.vault.getName();
    return this.folder === DEFAULT_MANUSCRIPT_FOLDER ? vault : `${vault} / ${this.folder}`;
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

  async jump(citation: EngineIssueCitation): Promise<void> { await selectPassage(this.app, citation); }

  async createManuscriptFolder(): Promise<void> {
    if (!this.app.vault.getFolderByPath(this.folder)) await this.app.vault.createFolder(this.folder);
    await this.refreshScan();
  }

  async setManuscriptFolder(value: string): Promise<void> {
    this.data.manuscriptFolder = value.trim() || DEFAULT_MANUSCRIPT_FOLDER;
    await this.save();
    this.scheduleScan();
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
