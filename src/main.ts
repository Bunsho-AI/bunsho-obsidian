import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, type WorkspaceLeaf } from "obsidian";
import { AUTH_CONFIG } from "./authConfig";
import { AuthError, TokenSource, type SessionStore } from "./auth";
import { formPost, makeTransport, readBalance } from "./connection";
import { acceptableEngineUrl, isLocalEngine } from "./engineUrl";
import { locateQuote } from "./locate";
import { projectMarkdown } from "./projection";
import { ProgressTracker } from "./progress";
import { runReview, type ReviewOutcome } from "./review";
import { buildChapters, chapterProblems, DEFAULT_MANUSCRIPT_FOLDER, roughWords, sha256, snapshotId, type Chapter, type SkippedNote } from "./structure";
import { PipelineV3Client, PipelineV3Error } from "./vendor/pipelineV3Client";
import { PIPELINE_V3_PRICE_OP, type PipelineV3Health } from "./vendor/pipelineV3.types";
import { pipelineV3ReviewCredits } from "./vendor/pipelineV3Pricing";
import type { EngineIssueCitation } from "./vendor/engine.types";
import { BunshoView, VIEW_TYPE } from "./view";

interface PluginData {
  manuscriptFolder: string;
  engineUrl: string;
  /** Local development only (engine with AUTH_OPTIONAL=true). Shown in settings only for a localhost engine. */
  devUid: string;
  installId: string;
  workspaceId: string;
  dismissed: string[];
  lastReview: ReviewOutcome | null;
  /** Fallback only when this Obsidian has no secret storage (older than 1.11.4). */
  refreshToken?: string;
}

const SECRET_ID = "bunsho-refresh-token";
const SCAN_DEBOUNCE_MS = 1500;

export type Scan =
  | { status: "no_folder" }
  | { status: "no_notes" }
  | { status: "ready"; chapters: Chapter[]; skipped: SkippedNote[]; chars: number; words: number; snapshotId: string };

export type Phase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "checking"; share: number; waiting: boolean }
  | { kind: "error"; message: string; charged?: boolean };

export interface Account { signedIn: boolean; balance: number | null; health: PipelineV3Health | null; problem: string | null }

/** Obsidian's editor holds LF text; files written elsewhere may have CRLF. One line-ending everywhere keeps offsets aligned. */
const lf = (text: string): string => text.replace(/\r\n?/gu, "\n");

export default class BunshoPlugin extends Plugin {
  data!: PluginData;
  scan: Scan = { status: "no_folder" };
  phase: Phase = { kind: "idle" };
  account: Account = { signedIn: false, balance: null, health: null, problem: null };
  private tokens!: TokenSource;
  private abort: AbortController | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | undefined;
  private scanSeq = 0;
  private accountSeq = 0;

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PluginData> | null;
    this.data = {
      manuscriptFolder: DEFAULT_MANUSCRIPT_FOLDER, engineUrl: AUTH_CONFIG.engineUrl, devUid: "",
      installId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), dismissed: [], lastReview: null, ...saved,
    };
    // A vault's data.json can be synced or copied from elsewhere: never send a token to an address that is not ours to trust.
    if (!acceptableEngineUrl(this.data.engineUrl)) this.data.engineUrl = AUTH_CONFIG.engineUrl;
    this.tokens = new TokenSource(formPost, await this.sessionStore());
    await this.save();

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new BunshoView(leaf, this));
    this.addRibbonIcon("book-open-check", "Bunsho: continuity", () => void this.openPanel());
    this.addCommand({ id: "open-panel", name: "Open continuity panel", callback: () => void this.openPanel() });
    this.addCommand({ id: "check-manuscript", name: "Check manuscript", callback: () => void this.check() });
    this.addCommand({ id: "sign-in", name: "Sign in with Google", callback: () => void this.signIn() });
    this.addCommand({ id: "sign-out", name: "Sign out", callback: () => void this.signOut() });
    this.addSettingTab(new BunshoSettingTab(this.app, this));

    // The vault is not indexed until the workspace is ready; registering earlier would scan once per file at startup.
    this.app.workspace.onLayoutReady(() => {
      void this.refresh();
      const onChange = (file: { path: string }, oldPath?: string) => {
        if (this.inManuscript(file.path) || (oldPath !== undefined && this.inManuscript(oldPath)) || this.isManuscriptFolder(file.path)) this.scheduleScan();
      };
      this.registerEvent(this.app.vault.on("create", (file) => onChange(file)));
      this.registerEvent(this.app.vault.on("delete", (file) => onChange(file)));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => onChange(file, oldPath)));
      this.registerEvent(this.app.vault.on("modify", (file) => onChange(file))); // a note autosaves every couple of seconds while typing
    });
  }

  onunload(): void {
    clearTimeout(this.scanTimer);
    this.abort?.abort();
  }

  async save(): Promise<void> { await this.saveData(this.data); }

  private async sessionStore(): Promise<SessionStore> {
    const secrets = (this.app as App & { secretStorage?: { getSecret(id: string): string | null; setSecret(id: string, value: string): void } }).secretStorage;
    if (secrets) {
      // Move a token left in data.json by an older Obsidian into secret storage, and out of the (possibly synced) file.
      if (this.data.refreshToken) {
        if (!secrets.getSecret(SECRET_ID)) secrets.setSecret(SECRET_ID, this.data.refreshToken);
        delete this.data.refreshToken;
      }
      return {
        get: async () => secrets.getSecret(SECRET_ID) || null,
        set: async (value) => { secrets.setSecret(SECRET_ID, value); },
        clear: async () => { secrets.setSecret(SECRET_ID, ""); if (this.data.refreshToken) { delete this.data.refreshToken; await this.save(); } },
      };
    }
    return {
      get: async () => this.data.refreshToken ?? null,
      set: async (value) => { this.data.refreshToken = value; await this.save(); },
      clear: async () => { delete this.data.refreshToken; await this.save(); },
    };
  }

  private get devUid(): string | undefined { return isLocalEngine(this.data.engineUrl) && this.data.devUid ? this.data.devUid : undefined; }

  private transport() {
    return makeTransport({ baseUrl: this.data.engineUrl, tokens: this.tokens, installId: this.data.installId, version: this.manifest.version,
      devUid: this.devUid, logger: { warn: (m, x) => console.warn(`[Bunsho] ${m}`, x), info: () => undefined } });
  }

  private get folder(): string { return this.data.manuscriptFolder.replace(/^\/+|\/+$/gu, ""); }
  private isManuscriptFolder(path: string): boolean { return path === this.folder; }
  private inManuscript(path: string): boolean {
    return path.endsWith(".md") && path.startsWith(`${this.folder}/`) && !path.slice(this.folder.length + 1).includes("/");
  }

  /** The note as the writer sees it: the open editor's text when the note is open (it may not be saved yet), else the file. */
  private async noteText(file: TFile): Promise<string> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path) return lf(view.editor.getValue());
    }
    return lf(await this.app.vault.read(file));
  }

  async refresh(): Promise<void> {
    await Promise.all([this.refreshScan(), this.refreshAccount()]);
  }

  scheduleScan(): void {
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => void this.refreshScan(), SCAN_DEBOUNCE_MS);
  }

  async refreshScan(): Promise<void> {
    clearTimeout(this.scanTimer);
    const seq = ++this.scanSeq;
    let next: Scan;
    if (!this.app.vault.getFolderByPath(this.folder)) next = { status: "no_folder" };
    else {
      const files = this.app.vault.getMarkdownFiles().filter((f) => this.inManuscript(f.path));
      const notes = await Promise.all(files.map(async (f) => ({ path: f.path, basename: f.basename, text: await this.noteText(f) })));
      const { chapters, skipped } = buildChapters(notes);
      next = chapters.length === 0 ? { status: "no_notes" } : {
        status: "ready", chapters, skipped, snapshotId: snapshotId(chapters),
        chars: chapters.reduce((n, c) => n + c.text.length, 0), words: chapters.reduce((n, c) => n + roughWords(c.text), 0),
      };
    }
    if (seq !== this.scanSeq) return; // a newer scan started while this one read notes
    this.scan = next;
    this.changed();
  }

  async refreshAccount(): Promise<void> {
    const seq = ++this.accountSeq;
    const signedIn = (await this.tokens.signedIn()) || Boolean(this.devUid);
    let next: Account = { signedIn, balance: null, health: null, problem: null };
    if (signedIn) {
      try {
        const transport = this.transport();
        const [health, balance] = await Promise.all([new PipelineV3Client(transport).health(), readBalance(transport)]);
        next = { signedIn, health, balance, problem: null };
      } catch (error) {
        next = error instanceof AuthError && error.code === "signed_out" ? { signedIn: false, balance: null, health: null, problem: error.message }
          : { ...next, problem: error instanceof PipelineV3Error || error instanceof AuthError ? error.message : "Could not reach Bunsho. Check your connection." };
      }
    }
    if (seq !== this.accountSeq) return; // signed out (or refreshed again) while this was in flight
    this.account = next;
    this.changed();
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
    if (this.phase.kind === "preparing" || this.phase.kind === "checking") return;
    this.phase = { kind: "preparing" };
    this.changed();
    try {
      await Promise.all([this.refreshScan(), this.refreshAccount()]);
      const { scan, account } = this;
      if (scan.status !== "ready") { new Notice("Bunsho: no chapters found. See the panel for the folder layout."); await this.openPanel(); return this.idle(); }
      if (!account.signedIn || !account.health) {
        if (account.problem) new Notice(account.problem);
        await this.openPanel();
        return this.idle();
      }
      const problems = chapterProblems(scan.chapters);
      if (problems.length > 0) return this.fail(problems[0]);
      const credits = this.price();
      if (credits !== null && account.balance !== null && account.balance < credits) {
        return this.fail(`This check costs about ${credits.toLocaleString("en-US")} credits and you have ${account.balance.toLocaleString("en-US")}. Add credits in Bunsho, then try again.`);
      }
      const confirmed = await confirmCheck(this.app, scan.chapters.length, scan.words, credits, account.balance);
      if (!confirmed) return this.idle();
      await this.runConfirmed(scan.chapters, account.health, credits);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "The check failed.");
    }
  }

  private async runConfirmed(chapters: Chapter[], health: PipelineV3Health, credits: number | null): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    const tracker = new ProgressTracker();
    this.phase = { kind: "checking", share: 0, waiting: true };
    this.changed();
    try {
      const outcome = await runReview({
        chapters, health, workspaceId: this.data.workspaceId, client: new PipelineV3Client(this.transport()),
        maxCredits: credits ?? undefined, signal: abort.signal,
        callbacks: { onProgress: (p) => { this.phase = { kind: "checking", share: tracker.update(p), waiting: false }; this.changed(); } },
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

  private idle(): void { this.phase = { kind: "idle" }; this.changed(); }
  private fail(message: string, charged?: boolean): void { this.phase = { kind: "error", message, charged }; this.changed(); }

  cancel(): void { this.abort?.abort(); }

  async dismiss(issueId: string, dismissed: boolean): Promise<void> {
    const set = new Set(this.data.dismissed);
    if (dismissed) set.add(issueId); else set.delete(issueId);
    this.data.dismissed = [...set];
    await this.save();
    this.changed();
  }

  async jump(citation: EngineIssueCitation): Promise<void> {
    const file = this.app.vault.getFileByPath(citation.page_id);
    if (!file) { new Notice("That chapter note has been moved or renamed since the check."); return; }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    // Offsets come from the editor's own text, so they always match what offsetToPos counts.
    const projection = projectMarkdown(view.editor.getValue());
    const hit = locateQuote(citation, projection, sha256(projection.text));
    if (!hit) { new Notice("This passage has changed since the check. Run the check again."); return; }
    const from = view.editor.offsetToPos(hit.from);
    const to = view.editor.offsetToPos(hit.to);
    view.editor.setSelection(from, to);
    view.editor.scrollIntoView({ from, to }, true);
  }

  async openPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async createManuscriptFolder(): Promise<void> {
    if (!this.app.vault.getFolderByPath(this.folder)) await this.app.vault.createFolder(this.folder);
    await this.refreshScan();
  }

  private changed(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof BunshoView) leaf.view.render();
  }
}

/** The price confirmation every check goes through. Resolves true only on an explicit "Check". */
function confirmCheck(app: App, chapters: number, words: number, credits: number | null, balance: number | null): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new Modal(app);
    modal.titleEl.setText("Check manuscript?");
    modal.contentEl.createEl("p", { text: `${chapters} ${chapters === 1 ? "chapter" : "chapters"}, about ${words.toLocaleString("en-US")} words.` });
    modal.contentEl.createEl("p", { text: credits === null ? "The price could not be read. You will not be charged more than the engine quotes when it starts."
      : `This check costs about ${credits.toLocaleString("en-US")} credits${balance === null ? "" : ` (you have ${balance.toLocaleString("en-US")})`}.` });
    modal.contentEl.createEl("p", { text: "It takes a few minutes. Keep Obsidian open until it finishes.", cls: "bunsho-muted" });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText("Not now").onClick(() => { answered = true; resolve(false); modal.close(); }))
      .addButton((b) => b.setButtonText("Check").setCta().onClick(() => { answered = true; resolve(true); modal.close(); }));
    modal.onClose = () => { if (!answered) resolve(false); };
    modal.open();
  });
}

class BunshoSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: BunshoPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Account").setDesc(this.plugin.account.signedIn ? "Signed in. Checks use your Bunsho credits." : "Sign in with the Google account you use for Bunsho.")
      .addButton((b) => b.setButtonText(this.plugin.account.signedIn ? "Sign out" : "Sign in with Google").onClick(async () => {
        if (this.plugin.account.signedIn) await this.plugin.signOut(); else await this.plugin.signIn();
        this.display();
      }));
    new Setting(containerEl).setName("Manuscript folder")
      .setDesc("One note per chapter, directly inside this folder. Chapters are read in name order (01, 02, ... 10), one paragraph per line.")
      .addText((t) => t.setPlaceholder(DEFAULT_MANUSCRIPT_FOLDER).setValue(this.plugin.data.manuscriptFolder).onChange(async (value) => {
        this.plugin.data.manuscriptFolder = value.trim() || DEFAULT_MANUSCRIPT_FOLDER;
        await this.plugin.save();
        this.plugin.scheduleScan();
      }));
    new Setting(containerEl).setName("Privacy").setDesc("Your chapter notes are sent to the Bunsho service, over an encrypted connection, only when you confirm a check. While the panel is open the plugin also reads your credit balance and the current price. The plugin sends no analytics.");
    new Setting(containerEl).setName("Engine address").setDesc("Leave this alone unless Bunsho support asks you to change it. Must start with https://.")
      .addText((t) => t.setValue(this.plugin.data.engineUrl).onChange(async (value) => {
        const next = value.trim() || AUTH_CONFIG.engineUrl;
        if (!acceptableEngineUrl(next)) return; // keep the last good address until the text is a valid one
        this.plugin.data.engineUrl = next;
        await this.plugin.save();
      }));
    if (isLocalEngine(this.plugin.data.engineUrl)) {
      new Setting(containerEl).setName("Developer user id").setDesc("Local engine with AUTH_OPTIONAL only.")
        .addText((t) => t.setValue(this.plugin.data.devUid).onChange(async (value) => { this.plugin.data.devUid = value.trim(); await this.plugin.save(); }));
    }
  }
}
