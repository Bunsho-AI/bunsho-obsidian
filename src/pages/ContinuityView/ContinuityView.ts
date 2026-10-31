/**
 * The Bunsho panel (an Obsidian view). The only UI layer that reads the controller: it turns state into props for the
 * organisms below. Mirrors the desktop Continuity tab; colours follow the writer's theme (see styles.css).
 */
import { ItemView, type WorkspaceLeaf } from "obsidian";
import { BUNSHO_ICON_ID } from "@/assets/logo";
import { FillButton } from "@/atoms/FillButton";
import type { ContinuityController } from "@/controllers/ContinuityController";
import type { ChapterMeta } from "@/lib/services/review/reviewService";
import type { EngineIssue, EngineIssueCitation } from "@/lib/contract/engine.types";
import { AlertCard } from "@/molecules/AlertCard";
import { BrandHeader } from "@/molecules/BrandHeader";
import { EmptyState } from "@/molecules/EmptyState";
import { StatusRow } from "@/molecules/StatusRow";
import { FindingsList, type FindingItem } from "@/organisms/FindingsList";
import { ManuscriptHelp } from "@/organisms/ManuscriptHelp";
import { SignInPanel } from "@/organisms/SignInPanel";
import { formatNumber, formatShortDate } from "@/utils/format";

export const VIEW_TYPE = "bunsho-continuity";
export const UPGRADE_URL = "https://bunsho.io/#pricing";

const STAGE_LABEL: Record<string, string> = {
  read: "reading chapters", cast: "finding the cast", search: "searching the book", triage: "sorting leads",
  judge: "weighing contradictions", timeline: "checking the timeline", names: "checking names", canon: "checking canon",
  assemble: "writing up findings",
};

export class ContinuityView extends ItemView {
  private showDismissed = false;
  private readonly expanded = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private readonly controller: ContinuityController) { super(leaf); }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Bunsho"; }
  getIcon(): string { return BUNSHO_ICON_ID; }

  async onOpen(): Promise<void> { this.render(); await this.controller.refresh(); }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("bunsho-panel");
    const c = this.controller;

    if (!c.account.signedIn) {
      SignInPanel(root, { problem: c.account.problem, onSignIn: () => void c.signIn() });
      return;
    }
    BrandHeader(root);
    this.renderStatus(root);
    const body = root.createDiv({ cls: "bunsho-body" });
    if (this.renderAlert(body)) return;
    if (c.scan.status !== "ready") {
      ManuscriptHelp(body, { folder: c.data.manuscriptFolder, folderExists: c.scan.status === "no_notes", onCreateFolder: () => void c.createManuscriptFolder() });
      return;
    }
    this.renderFindings(body);
  }

  private renderStatus(root: HTMLElement): void {
    const c = this.controller;
    const { phase, scan } = c;
    if (phase.kind === "checking") {
      const fact = phase.waiting ? "starting the check…" : `reviewing ${Math.round(phase.share * 100)}% · ${STAGE_LABEL[phase.stage ?? ""] ?? "reading"}`;
      StatusRow(root, { fact, reading: true, action: { label: "Cancel", onClick: () => c.cancel() } });
      return;
    }
    if (phase.kind === "preparing" || phase.kind === "confirming") {
      StatusRow(root, { fact: phase.kind === "preparing" ? "reading your chapters…" : "confirm the price to start" });
      return;
    }
    if (scan.status !== "ready") { StatusRow(root, { fact: "Nothing to check yet" }); return; }

    const review = c.currentReview();
    const parts = [`${scan.chapters.length} ${scan.chapters.length === 1 ? "chapter" : "chapters"}`, `${formatNumber(scan.words)} words`];
    if (review) parts.push(scan.snapshotId === review.snapshotId ? `checked ${formatShortDate(review.checkedAt)}` : "edited since last check");
    // One priced action: before the first check it is the empty state's button, after it this link.
    const showAction = review !== null && c.account.project !== "blocked";
    StatusRow(root, { fact: parts.join(" · "), action: showAction ? { label: this.checkLabel(), onClick: () => void c.check() } : undefined });
  }

  /** At most one alert card. Returns true when it replaces the rest of the panel. */
  private renderAlert(body: HTMLElement): boolean {
    const c = this.controller;
    const { phase, account, scan } = c;
    if (account.project === "blocked") {
      AlertCard(body, { title: "One project on the free plan",
        body: `Your free project is “${account.registeredName ?? "your other manuscript"}”. Upgrade to check this manuscript too.`,
        action: { label: "See plans", onClick: () => window.open(UPGRADE_URL) } });
      return true;
    }
    if (phase.kind === "error") {
      AlertCard(body, { title: phase.charged ? "The check stopped" : "The check did not run", body: phase.message });
      return false;
    }
    const price = c.price();
    if (scan.status === "ready" && account.balance !== null && price !== null && account.balance < price) {
      AlertCard(body, { title: "Not enough credits", body: `This check costs about ${formatNumber(price)} credits and you have ${formatNumber(account.balance)}.`,
        action: { label: "Add credits", onClick: () => window.open(UPGRADE_URL) } });
      return false;
    }
    if (account.problem) AlertCard(body, { title: "Bunsho is unreachable", body: account.problem });
    return false;
  }

  private renderFindings(body: HTMLElement): void {
    const c = this.controller;
    const review = c.currentReview();
    if (!review) {
      const box = EmptyState(body, { title: "Nothing has been checked yet",
        body: "Bunsho reads every chapter and shows where your story contradicts itself, quoting both passages. You see the price before anything is spent." });
      if (c.phase.kind === "idle" || c.phase.kind === "error") FillButton(box, { label: this.checkLabel(), onClick: () => void c.check() });
      return;
    }
    const dismissed = new Set(c.data.dismissed);
    const chapters = new Map(review.chapters.map((ch) => [ch.pageId, ch]));
    const toItem = (issue: EngineIssue): FindingItem => ({
      id: issue.issue_id,
      claim: issue.message,
      severity: issue.severity,
      passages: issue.citations.filter((ct) => ct.evidence_role !== "supporting_context").map((ct) => ({
        quote: ct.quoted_text, coordinate: this.coordinate(ct, chapters, true), shortCoordinate: this.coordinate(ct, chapters, false),
        onGo: () => void c.jump(ct),
      })),
      expanded: this.expanded.has(issue.issue_id),
      onExpand: () => { this.expanded.add(issue.issue_id); this.render(); },
      onToggleDismissed: () => void c.dismiss(issue.issue_id, !dismissed.has(issue.issue_id)),
    });
    FindingsList(body, {
      open: review.issues.filter((i) => !dismissed.has(i.issue_id)).map(toItem),
      dismissed: review.issues.filter((i) => dismissed.has(i.issue_id)).map(toItem),
      anyFindings: review.issues.length > 0,
      chaptersChecked: review.chapters.length - review.unreadPages.length,
      chaptersTotal: review.chapters.length,
      showDismissed: this.showDismissed,
      onToggleShowDismissed: () => { this.showDismissed = !this.showDismissed; this.render(); },
    });
  }

  private checkLabel(): string {
    const price = this.controller.price();
    return price === null ? "Check manuscript" : `Check manuscript · ~${formatNumber(price)} credits`;
  }

  private coordinate(citation: EngineIssueCitation, chapters: Map<string, ChapterMeta>, withTitle: boolean): string {
    const chapter = chapters.get(citation.page_id);
    if (!chapter) return citation.location_label;
    return withTitle ? `Ch ${chapter.order + 1} · ${chapter.title}` : `Ch ${chapter.order + 1}`;
  }
}
