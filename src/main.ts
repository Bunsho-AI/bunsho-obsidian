import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, type WorkspaceLeaf } from "obsidian";
import { AUTH_CONFIG } from "./authConfig";
import { AuthError, TokenSource, type SessionStore } from "./auth";
import { formPost, makeTransport, readBalance } from "./connection";
import { locateQuote } from "./locate";
import { projectMarkdown } from "./projection";
import { ProgressTracker } from "./progress";
import { runReview, type ReviewOutcome } from "./review";
import { buildChapters, DEFAULT_MANUSCRIPT_FOLDER, roughWords, sha256, type Chapter, type SkippedNote } from "./structure";
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

export type Scan =
  | { status: "no_folder" }
  | { status: "no_notes" }
  | { status: "ready"; chapters: Chapter[]; skipped: SkippedNote[]; chars: number; words: number };

export type Phase = { kind: "idle" } | { kind: "checking"; share: number; waiting: boolean } | { kind: "error"; message: string; charged?: boolean };

export interface Account { signedIn: boolean; balance: number | null; health: PipelineV3Health | null; problem: string | null }

export default class BunshoPlugin extends Plugin {
  data!: PluginData;
  scan: Scan = { status: "no_folder" };
  phase: Phase = { kind: "idle" };
  account: Account = { signedIn: false, balance: null, health: null, problem: null };
  private tokens!: TokenSource;
  private abort: AbortController | null = null;

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PluginData> | null;
    this.data = {
      manuscriptFolder: DEFAULT_MANUSCRIPT_FOLDER, engineUrl: AUTH_CONFIG.engineUrl, devUid: "",
      installId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), dismissed: [], lastReview: null, ...saved,
    };
    await this.save();
    this.tokens = new TokenSource(formPost, this.sessionStore());

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new BunshoView(leaf, this));
    this.addRibbonIcon("book-open-check", "Bunsho: continuity", () => void this.openPanel());
    this.addCommand({ id: "open-panel", name: "Open continuity panel", callback: () => void this.openPanel() });
    this.addCommand({ id: "check-manuscript", name: "Check manuscript", callback: () => void this.check() });
    this.addCommand({ id: "sign-in", name: "Sign in with Google", callback: () => void this.signIn() });
    this.addCommand({ id: "sign-out", name: "Sign out", callback: () => void this.signOut() });
    this.addSettingTab(new BunshoSettingTab(this.app, this));

    // The vault is not indexed until the workspace is ready; scanning earlier would see no notes.
    this.app.workspace.onLayoutReady(() => void this.refresh());
    this.registerEvent(this.app.vault.on("create", () => void this.refreshScan()));
    this.registerEvent(this.app.vault.on("delete", () => void this.refreshScan()));
    this.registerEvent(this.app.vault.on("rename", () => void this.refreshScan()));
    let pending: ReturnType<typeof setTimeout> | undefined;
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!this.inManuscript(file.path)) return;
      clearTimeout(pending); // a note autosaves every couple of seconds while the writer types
      pending = setTimeout(() => void this.refreshScan(), 1500);
    }));
  }

  onunload(): void { this.abort?.abort(); }

  async save(): Promise<void> { await this.saveData(this.data); }

  private sessionStore(): SessionStore {
    const secrets = (this.app as App & { secretStorage?: { getSecret(id: string): string | null; setSecret(id: string, value: string): void } }).secretStorage;
    if (secrets) {
      return {
        get: async () => secrets.getSecret(SECRET_ID) || null,
        set: async (value) => { secrets.setSecret(SECRET_ID, value); },
        clear: async () => { secrets.setSecret(SECRET_ID, ""); },
      };
    }
    return {
      get: async () => this.data.refreshToken ?? null,
      set: async (value) => { this.data.refreshToken = value; await this.save(); },
      clear: async () => { delete this.data.refreshToken; await this.save(); },
    };
  }

  private get isDev(): boolean { return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/u.test(this.data.engineUrl); }

  private transport() {
    return makeTransport({ baseUrl: this.data.engineUrl, tokens: this.tokens, installId: this.data.installId, version: this.manifest.version,
      devUid: this.isDev && this.data.devUid ? this.data.devUid : undefined, logger: { warn: (m, x) => console.warn(`[Bunsho] ${m}`, x), info: () => undefined } });
  }

  private inManuscript(path: string): boolean {
    const folder = this.data.manuscriptFolder.replace(/^\/+|\/+$/gu, "");
    return path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes("/");
  }

  /** The note as the writer sees it: the open editor's text when the note is open (it may not be saved yet), else the file. */
  private async noteText(file: TFile): Promise<string> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path) return view.editor.getValue();
    }
    return this.app.vault.read(file);
  }

  async refresh(): Promise<void> {
    await Promise.all([this.refreshScan(), this.refreshAccount()]);
  }

  async refreshScan(): Promise<void> {
    const folder = this.data.manuscriptFolder.replace(/^\/+|\/+$/gu, "");
    if (!this.app.vault.getFolderByPath(folder)) this.scan = { status: "no_folder" };
    else {
      const files = this.app.vault.getMarkdownFiles().filter((f) => this.inManuscript(f.path));
      const notes = await Promise.all(files.map(async (f) => ({ path: f.path, basename: f.basename, text: await this.noteText(f) })));
      const { chapters, skipped } = buildChapters(notes);
      this.scan = chapters.length === 0 ? { status: "no_notes" }
        : { status: "ready", chapters, skipped, chars: chapters.reduce((n, c) => n + c.text.length, 0), words: chapters.reduce((n, c) => n + roughWords(c.text), 0) };
    }
    this.changed();
  }

  async refreshAccount(): Promise<void> {
    const signedIn = (await this.tokens.signedIn()) || Boolean(this.isDev && this.data.devUid);
    this.account = { signedIn, balance: null, health: null, problem: null };
    if (signedIn) {
      try {
        const client = new PipelineV3Client(this.transport());
        const [health, balance] = await Promise.all([client.health(), readBalance(this.transport())]);
        this.account = { signedIn, health, balance, problem: null };
      } catch (error) {
        if (error instanceof AuthError && error.code === "signed_out") this.account = { signedIn: false, balance: null, health: null, problem: error.message };
        else this.account = { ...this.account, problem: error instanceof PipelineV3Error ? error.message : "Could not reach Bunsho. Check your connection." };
      }
    }
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
    await this.tokens.signOut();
    this.data.lastReview = null;
    await this.save();
    await this.refreshAccount();
  }

  async check(): Promise<void> {
    if (this.phase.kind === "checking") return;
    await this.refreshScan();
    if (this.scan.status !== "ready") { new Notice("Bunsho: no chapters found. See the panel for the folder layout."); await this.openPanel(); return; }
    if (!this.account.health) await this.refreshAccount();
    const { health } = this.account;
    if (!this.account.signedIn || !health) { await this.openPanel(); return; }
    const { chapters } = this.scan;
    const credits = this.price();
    this.abort = new AbortController();
    const tracker = new ProgressTracker();
    this.phase = { kind: "checking", share: 0, waiting: true };
    this.changed();
    try {
      const outcome = await runReview({
        chapters, health, workspaceId: this.data.workspaceId, client: new PipelineV3Client(this.transport()),
        maxCredits: credits ?? undefined, signal: this.abort.signal,
        callbacks: { onProgress: (p) => { this.phase = { kind: "checking", share: tracker.update(p), waiting: false }; this.changed(); } },
      });
      this.data.lastReview = outcome;
      await this.save();
      this.phase = { kind: "idle" };
      await this.refreshAccount();
    } catch (error) {
      this.phase = error instanceof PipelineV3Error && error.code === "cancelled" ? { kind: "idle" }
        : { kind: "error", message: error instanceof Error ? error.message : "The check failed." , charged: error instanceof PipelineV3Error ? error.detail.charged : undefined };
      this.changed();
    } finally { this.abort = null; }
  }

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
    const projection = projectMarkdown(await this.noteText(file));
    const hit = locateQuote(citation, projection, sha256(projection.text));
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (!hit) { new Notice("This passage has changed since the check. Run the check again."); return; }
    if (view instanceof MarkdownView) {
      const from = view.editor.offsetToPos(hit.from);
      const to = view.editor.offsetToPos(hit.to);
      view.editor.setSelection(from, to);
      view.editor.scrollIntoView({ from, to }, true);
    }
  }

  async openPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private changed(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof BunshoView) leaf.view.render();
  }
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
        await this.plugin.refreshScan();
      }));
    new Setting(containerEl).setName("Privacy").setDesc("Checking sends your chapter notes to the Bunsho service, over an encrypted connection, only when you press Check manuscript. Nothing is sent otherwise. The plugin sends no analytics.");
    new Setting(containerEl).setName("Engine address").setDesc("Leave this alone unless Bunsho support asks you to change it.")
      .addText((t) => t.setValue(this.plugin.data.engineUrl).onChange(async (value) => {
        this.plugin.data.engineUrl = value.trim() || AUTH_CONFIG.engineUrl;
        await this.plugin.save();
        this.display();
      }));
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/u.test(this.plugin.data.engineUrl)) {
      new Setting(containerEl).setName("Developer user id").setDesc("Local engine with AUTH_OPTIONAL only.")
        .addText((t) => t.setValue(this.plugin.data.devUid).onChange(async (value) => { this.plugin.data.devUid = value.trim(); await this.plugin.save(); await this.plugin.refreshAccount(); }));
    }
  }
}
