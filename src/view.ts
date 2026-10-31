import { ItemView, type WorkspaceLeaf } from "obsidian";
import type BunshoPlugin from "./main";
import type { EngineIssue } from "./vendor/engine.types";

export const VIEW_TYPE = "bunsho-continuity";

const ROLE_LABEL: Record<string, string> = { prior_fact: "Earlier", current_conflict: "Here", supporting_context: "Context" };

export class BunshoView extends ItemView {
  private showDismissed = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: BunshoPlugin) { super(leaf); }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Bunsho"; }
  getIcon(): string { return "book-open-check"; }

  async onOpen(): Promise<void> { this.render(); void this.plugin.refresh(); }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("bunsho-panel");
    const { account, scan, phase } = this.plugin;

    if (!account.signedIn) {
      const box = root.createDiv({ cls: "bunsho-box" });
      box.createEl("h4", { text: "Check your story for contradictions" });
      box.createEl("p", { text: "Sign in with the Google account you use for Bunsho. Your chapters are only sent when you start a check." });
      if (account.problem) box.createEl("p", { text: account.problem, cls: "bunsho-problem" });
      box.createEl("button", { text: "Sign in with Google", cls: "mod-cta" }).onclick = () => void this.plugin.signIn();
      return; // Rule: nothing in the plugin works without a Bunsho sign-in (no layout help, no check, no findings).
    }

    this.renderStructure(root);
    if (scan.status === "ready") this.renderCheck(root);
    if (phase.kind === "error") {
      const box = root.createDiv({ cls: "bunsho-box bunsho-error" });
      box.createEl("p", { text: phase.message });
    }
    this.renderFindings(root);
  }

  private renderStructure(root: HTMLElement): void {
    const { scan } = this.plugin;
    if (scan.status === "ready") {
      const line = root.createDiv({ cls: "bunsho-summary" });
      line.createSpan({ text: `${scan.chapters.length} ${scan.chapters.length === 1 ? "chapter" : "chapters"}` });
      line.createSpan({ text: ` · about ${scan.words.toLocaleString("en-US")} words` });
      if (scan.skipped.length > 0) line.createSpan({ text: ` · ${scan.skipped.length} empty ${scan.skipped.length === 1 ? "note" : "notes"} skipped`, cls: "bunsho-muted" });
      return;
    }
    const folder = this.plugin.data.manuscriptFolder;
    const box = root.createDiv({ cls: "bunsho-box" });
    box.createEl("h4", { text: scan.status === "no_folder" ? `No “${folder}” folder yet` : `No chapters in “${folder}”` });
    box.createEl("p", { text: "Bunsho reads your manuscript in one layout:" });
    box.createEl("pre", { text: `${folder}/\n  01 The Arrival.md\n  02 The Letter.md\n  03 ...` });
    const rules = box.createEl("ul");
    rules.createEl("li", { text: "One note per chapter, directly inside the folder." });
    rules.createEl("li", { text: "Chapters are read in name order, so number them: 01, 02, ... 10." });
    rules.createEl("li", { text: "One paragraph per line." });
    if (scan.status === "no_folder") {
      box.createEl("button", { text: `Create “${folder}” folder` }).onclick = () => void this.plugin.createManuscriptFolder();
    }
  }

  private renderCheck(root: HTMLElement): void {
    const { phase, account } = this.plugin;
    const box = root.createDiv({ cls: "bunsho-box" });
    if (phase.kind === "preparing" || phase.kind === "confirming") {
      box.createEl("p", { text: phase.kind === "preparing" ? "Reading your chapters and the current price..." : "Confirm the price to start the check.", cls: "bunsho-muted" });
      return;
    }
    if (phase.kind === "checking") {
      const bar = box.createDiv({ cls: "bunsho-bar" });
      bar.createDiv({ cls: "bunsho-bar-fill" }).style.width = `${Math.round(phase.share * 100)}%`;
      box.createEl("p", { text: phase.waiting ? "Starting the check..." : `Checking... ${Math.round(phase.share * 100)}%`, cls: "bunsho-muted" });
      box.createEl("p", { text: "Keep Obsidian open until it finishes.", cls: "bunsho-muted" });
      box.createEl("button", { text: "Cancel" }).onclick = () => this.plugin.cancel();
      return;
    }
    const price = this.plugin.price();
    const short = account.balance !== null && price !== null && account.balance < price;
    const button = box.createEl("button", { text: "Check manuscript", cls: "mod-cta" });
    button.disabled = !account.signedIn;
    button.onclick = () => void this.plugin.check();
    if (account.signedIn && price !== null) {
      box.createEl("p", { text: `About ${price.toLocaleString("en-US")} credits${account.balance !== null ? ` · you have ${account.balance.toLocaleString("en-US")}` : ""}`, cls: "bunsho-muted" });
    }
    if (short) box.createEl("p", { text: "You do not have enough credits for this check. Add credits in Bunsho, then try again.", cls: "bunsho-problem" });
    if (account.signedIn && account.problem) box.createEl("p", { text: account.problem, cls: "bunsho-problem" });
  }

  private renderFindings(root: HTMLElement): void {
    const review = this.plugin.data.lastReview;
    // Findings from another manuscript folder (the setting changed since) are not about this manuscript.
    if (!review || review.chapters.some((c) => !this.plugin.inManuscript(c.pageId))) return;
    const { scan } = this.plugin;
    const dismissed = new Set(this.plugin.data.dismissed);
    const open = review.issues.filter((i) => !dismissed.has(i.issue_id));
    const hidden = review.issues.length - open.length;
    const edited = scan.status === "ready" && scan.snapshotId !== review.snapshotId;

    const head = root.createDiv({ cls: "bunsho-findings-head" });
    head.createEl("h4", { text: review.issues.length === 0 ? "No contradictions found"
      : open.length === 0 ? "No open findings" : `${open.length} ${open.length === 1 ? "finding" : "findings"}` });
    head.createDiv({ cls: "bunsho-muted", text: `Checked ${new Date(review.checkedAt).toLocaleString()}${edited ? " · text edited since" : ""}` });
    if (review.unreadPages.length > 0) {
      root.createEl("p", { text: `${review.unreadPages.length} ${review.unreadPages.length === 1 ? "chapter" : "chapters"} could not be read and ${review.unreadPages.length === 1 ? "was" : "were"} not checked.`, cls: "bunsho-problem" });
    }
    for (const issue of open) this.renderIssue(root, issue, false);
    if (hidden > 0) {
      const toggle = root.createEl("button", { text: this.showDismissed ? `Hide ${hidden} dismissed` : `Show ${hidden} dismissed`, cls: "bunsho-link" });
      toggle.onclick = () => { this.showDismissed = !this.showDismissed; this.render(); };
      if (this.showDismissed) for (const issue of review.issues.filter((i) => dismissed.has(i.issue_id))) this.renderIssue(root, issue, true);
    }
  }

  private renderIssue(root: HTMLElement, issue: EngineIssue, dismissed: boolean): void {
    const review = this.plugin.data.lastReview!;
    const titles = new Map(review.chapters.map((c) => [c.pageId, c.title]));
    const card = root.createDiv({ cls: `bunsho-card${dismissed ? " is-dismissed" : ""}` });
    card.createDiv({ cls: `bunsho-severity is-${issue.severity}` });
    const body = card.createDiv({ cls: "bunsho-card-body" });
    body.createEl("p", { text: issue.message, cls: "bunsho-message" });
    for (const citation of issue.citations.filter((c) => c.evidence_role !== "supporting_context")) {
      const quote = body.createDiv({ cls: "bunsho-quote" });
      quote.createDiv({ cls: "bunsho-quote-label", text: `${ROLE_LABEL[citation.evidence_role] ?? "Passage"} · ${titles.get(citation.page_id) ?? citation.location_label}` });
      quote.createEl("blockquote", { text: citation.quoted_text });
      quote.createEl("button", { text: "Go to passage", cls: "bunsho-link" }).onclick = () => void this.plugin.jump(citation);
    }
    const actions = body.createDiv({ cls: "bunsho-actions" });
    actions.createEl("button", { text: dismissed ? "Restore" : "Dismiss", cls: "bunsho-link" }).onclick = () => void this.plugin.dismiss(issue.issue_id, !dismissed);
  }
}

