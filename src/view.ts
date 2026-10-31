/**
 * The Bunsho panel. Mirrors the desktop Continuity tab (warm-paper redesign): one status row of machine fact with the
 * single priced action, at most one alert card, findings grouped as "Open contradiction" / "Worth a look", and a
 * collapsed footer for findings marked "Not an error". Colours come from the writer's Obsidian theme; layout, type
 * roles, severity grammar, copy and the amber accent are Bunsho's (see .claude/plans/obsidian-plugin-design.md).
 */
import { ItemView, type WorkspaceLeaf } from "obsidian";
import type BunshoPlugin from "./main";
import type { ChapterMeta } from "./review";
import type { EngineIssue, EngineIssueCitation } from "./vendor/engine.types";

export const VIEW_TYPE = "bunsho-continuity";

export const UPGRADE_URL = "https://bunsho.io/pricing";

const STAGE_LABEL: Record<string, string> = {
  read: "reading chapters", cast: "finding the cast", search: "searching the book", triage: "sorting leads",
  judge: "weighing contradictions", timeline: "checking the timeline", names: "checking names", canon: "checking canon",
  assemble: "writing up findings",
};

const fmt = (n: number): string => n.toLocaleString("en-US");
const shortDate = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export class BunshoView extends ItemView {
  private showDismissed = false;
  private readonly expanded = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private readonly plugin: BunshoPlugin) { super(leaf); }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Bunsho"; }
  getIcon(): string { return "book-open-check"; }

  async onOpen(): Promise<void> { this.render(); await this.plugin.refresh(); }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("bunsho-panel");

    if (!this.plugin.account.signedIn) { this.renderSignedOut(root); return; }

    this.renderStatusRow(root);
    const body = root.createDiv({ cls: "bunsho-body" });
    if (this.renderAlert(body)) return;
    if (this.plugin.scan.status !== "ready") { this.renderNoChapters(body); return; }
    this.renderFindings(body);
  }

  // Signed out: the whole panel is the sign-in (nothing in the plugin works without it).
  private renderSignedOut(root: HTMLElement): void {
    const box = root.createDiv({ cls: "bunsho-empty" });
    box.createDiv({ cls: "bunsho-empty-title", text: "Check your story for contradictions" });
    box.createEl("p", { cls: "bunsho-empty-body", text: "Sign in with the Google account you use for Bunsho. Your chapters are only sent when you start a check." });
    if (this.plugin.account.problem) box.createEl("p", { cls: "bunsho-problem", text: this.plugin.account.problem });
    box.createEl("button", { cls: "bunsho-fill", text: "Sign in with Google" }).onclick = () => void this.plugin.signIn();
  }

  /** One line of machine fact, and the one priced action (or Cancel while a check runs). */
  private renderStatusRow(root: HTMLElement): void {
    const { scan, phase, account } = this.plugin;
    const review = this.plugin.currentReview();
    const row = root.createDiv({ cls: "bunsho-status" });
    const fact = row.createSpan({ cls: "bunsho-fact bunsho-status-text" });
    const action = row.createSpan({ cls: "bunsho-status-action" });

    if (phase.kind === "checking") {
      fact.addClass("is-reading");
      fact.setText(phase.waiting ? "starting the check…" : `reviewing ${Math.round(phase.share * 100)}% · ${STAGE_LABEL[phase.stage ?? ""] ?? "reading"}`);
      this.link(action, "Cancel", () => this.plugin.cancel());
      return;
    }
    if (phase.kind === "preparing" || phase.kind === "confirming") {
      fact.setText(phase.kind === "preparing" ? "reading your chapters…" : "confirm the price to start");
      return;
    }
    if (scan.status !== "ready") { fact.setText("Nothing to check yet"); return; }

    const parts = [`${scan.chapters.length} ${scan.chapters.length === 1 ? "chapter" : "chapters"}`, `${fmt(scan.words)} words`];
    if (review) parts.push(scan.snapshotId === review.snapshotId ? `checked ${shortDate(review.checkedAt)}` : "edited since last check");
    fact.setText(parts.join(" · "));

    if (account.project === "blocked") return; // the alert card explains; no priced action on a project the plan does not cover
    const price = this.plugin.price();
    this.link(action, price === null ? "Check manuscript" : `Check manuscript · ~${fmt(price)} credits`, () => void this.plugin.check());
  }

  /** At most one alert card, as on desktop. Returns true when the alert replaces the rest of the panel. */
  private renderAlert(body: HTMLElement): boolean {
    const { phase, account, scan } = this.plugin;
    if (account.project === "blocked") {
      const card = this.alertCard(body, "One project on the free plan");
      card.createEl("p", { text: `Your free project is “${account.registeredName ?? "your other manuscript"}”. Upgrade to check this manuscript too.` });
      this.link(card.createDiv(), "See plans", () => window.open(UPGRADE_URL));
      return true;
    }
    if (phase.kind === "error") {
      const card = this.alertCard(body, phase.charged ? "The check stopped" : "The check did not run");
      card.createEl("p", { text: phase.message });
      return false;
    }
    const price = this.plugin.price();
    if (scan.status === "ready" && account.balance !== null && price !== null && account.balance < price) {
      const card = this.alertCard(body, "Not enough credits");
      card.createEl("p", { text: `This check costs about ${fmt(price)} credits and you have ${fmt(account.balance)}.` });
      this.link(card.createDiv(), "Add credits", () => window.open(UPGRADE_URL));
      return false;
    }
    if (account.problem) {
      const card = this.alertCard(body, "Bunsho is unreachable");
      card.createEl("p", { text: account.problem });
    }
    return false;
  }

  private renderNoChapters(body: HTMLElement): void {
    const folder = this.plugin.data.manuscriptFolder;
    const box = body.createDiv({ cls: "bunsho-empty" });
    box.createDiv({ cls: "bunsho-empty-title", text: "Nothing to check yet" });
    box.createEl("p", { cls: "bunsho-empty-body", text: this.plugin.scan.status === "no_folder"
      ? `Bunsho reads your manuscript from a folder called “${folder}”, one note per chapter.`
      : `Add your chapters to “${folder}”, one note per chapter.` });
    box.createEl("pre", { cls: "bunsho-tree", text: `${folder}/\n  01 The Arrival.md\n  02 The Letter.md\n  03 …` });
    const rules = box.createEl("ul", { cls: "bunsho-rules" });
    rules.createEl("li", { text: "Chapters are read in name order, so number them: 01, 02, … 10." });
    rules.createEl("li", { text: "One paragraph per line." });
    if (this.plugin.scan.status === "no_folder") {
      box.createEl("button", { cls: "bunsho-quiet", text: `Create “${folder}” folder` }).onclick = () => void this.plugin.createManuscriptFolder();
    }
  }

  private renderFindings(body: HTMLElement): void {
    const review = this.plugin.currentReview();
    if (!review) {
      const box = body.createDiv({ cls: "bunsho-empty" });
      box.createDiv({ cls: "bunsho-empty-title", text: "Nothing has been checked yet" });
      box.createEl("p", { cls: "bunsho-empty-body", text: "Bunsho reads every chapter and shows where your story contradicts itself, quoting both passages. You see the price before anything is spent." });
      return;
    }
    const dismissed = new Set(this.plugin.data.dismissed);
    const open = review.issues.filter((i) => !dismissed.has(i.issue_id));
    const rank1 = open.filter((i) => i.severity === "error");
    const lower = open.filter((i) => i.severity !== "error");

    if (open.length === 0) {
      const box = body.createDiv({ cls: "bunsho-empty" });
      box.createDiv({ cls: "bunsho-empty-title", text: review.issues.length === 0 ? "No contradictions found" : "No open findings" });
      box.createDiv({ cls: "bunsho-fact", text: `${review.chapters.length - review.unreadPages.length}/${review.chapters.length} chapters checked` });
    }
    if (review.unreadPages.length > 0 && open.length > 0) {
      body.createDiv({ cls: "bunsho-fact bunsho-note", text: `${review.unreadPages.length} of ${review.chapters.length} chapters could not be read and were not checked` });
    }

    const chapters = new Map(review.chapters.map((c) => [c.pageId, c]));
    if (rank1.length > 0) {
      this.groupHeader(body, "Open contradiction", rank1.length, true);
      const list = body.createDiv({ cls: "bunsho-list" });
      for (const issue of rank1) this.card(list, issue, chapters, true, false);
    }
    if (lower.length > 0) {
      this.groupHeader(body, "Worth a look", lower.length, false);
      const list = body.createDiv({ cls: "bunsho-list" });
      for (const issue of lower) this.card(list, issue, chapters, false, false);
    }

    const hidden = review.issues.filter((i) => dismissed.has(i.issue_id));
    if (hidden.length > 0) {
      const footer = body.createDiv({ cls: "bunsho-footer" });
      footer.createSpan({ text: `${hidden.length} marked not an error · ` });
      this.link(footer, this.showDismissed ? "Hide" : "Show", () => { this.showDismissed = !this.showDismissed; this.render(); });
      if (this.showDismissed) {
        const list = body.createDiv({ cls: "bunsho-list" });
        for (const issue of hidden) this.card(list, issue, chapters, false, true);
      }
    }
  }

  private groupHeader(body: HTMLElement, label: string, count: number, rank1: boolean): void {
    const head = body.createDiv({ cls: `bunsho-group${rank1 ? " is-rank1" : ""}` });
    head.createSpan({ cls: "bunsho-group-label", text: label });
    head.createSpan({ cls: "bunsho-fact", text: String(count) });
  }

  private card(list: HTMLElement, issue: EngineIssue, chapters: Map<string, ChapterMeta>, rank1: boolean, dismissed: boolean): void {
    const card = list.createDiv({ cls: `bunsho-card${rank1 ? " is-rank1" : ""}${dismissed ? " is-dismissed" : ""}` });
    card.createSpan({ cls: "bunsho-severity", text: issue.severity === "error" ? "error" : issue.severity === "warning" ? "warning" : "note" });
    card.createDiv({ cls: "bunsho-claim", text: issue.message });

    const passages = issue.citations.filter((c) => c.evidence_role !== "supporting_context");
    const open = rank1 || this.expanded.has(issue.issue_id);
    if (open) {
      for (const citation of passages) this.passage(card, citation, chapters);
    }

    const foot = card.createDiv({ cls: "bunsho-card-foot" });
    const coords = foot.createSpan({ cls: "bunsho-fact bunsho-coords" });
    if (!open) {
      coords.setText(passages.map((c) => this.chapterLabel(c, chapters, false)).join(" · "));
      coords.addClass("is-clickable");
      coords.onclick = () => { this.expanded.add(issue.issue_id); this.render(); };
    }
    const actions = foot.createSpan({ cls: "bunsho-actions" });
    const toggle = actions.createEl("button", { cls: "bunsho-text-action is-quiet", text: dismissed ? "Restore" : "Not an error" });
    toggle.onclick = () => void this.plugin.dismiss(issue.issue_id, !dismissed);
  }

  /** One quoted passage, its coordinate under it; clicking either selects it in the note. */
  private passage(card: HTMLElement, citation: EngineIssueCitation, chapters: Map<string, ChapterMeta>): void {
    const block = card.createDiv({ cls: "bunsho-passage", attr: { role: "button", tabindex: "0", "aria-label": "Go to passage" } });
    block.createDiv({ cls: "bunsho-quote", text: citation.quoted_text });
    block.createDiv({ cls: "bunsho-fact bunsho-coords", text: this.chapterLabel(citation, chapters, true) });
    const go = () => void this.plugin.jump(citation);
    block.onclick = go;
    block.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); go(); } };
  }

  private chapterLabel(citation: EngineIssueCitation, chapters: Map<string, ChapterMeta>, withTitle: boolean): string {
    const chapter = chapters.get(citation.page_id);
    if (!chapter) return citation.location_label;
    return withTitle ? `Ch ${chapter.order + 1} · ${chapter.title}` : `Ch ${chapter.order + 1}`;
  }

  private alertCard(body: HTMLElement, title: string): HTMLElement {
    const card = body.createDiv({ cls: "bunsho-alert" });
    card.createDiv({ cls: "bunsho-alert-title", text: title });
    return card;
  }

  private link(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "bunsho-text-action", text });
    button.onclick = onClick;
    return button;
  }
}
