/**
 * The Bunsho panel (an Obsidian view). The only UI layer that reads the controller: it turns state into props for the
 * organisms below. Mirrors the desktop Continuity tab; colours follow the writer's theme (see styles.css).
 */
import { ItemView, type WorkspaceLeaf } from "obsidian";
import { BUNSHO_ICON_ID } from "@/assets/logo";
import { FillButton } from "@/atoms/FillButton";
import type { ContinuityController } from "@/controllers/ContinuityController";
import { AiNotice } from "@/atoms/AiNotice";
import { QuietButton } from "@/atoms/QuietButton";
import { TextAction } from "@/atoms/TextAction";
import { Fact } from "@/atoms/Fact";
import type { PageMeta } from "@/helpers/sources";
import type { EngineIssue, EngineIssueCitation } from "@/lib/contract/engine.types";
import { AlertCard } from "@/molecules/AlertCard";
import { BrandHeader } from "@/molecules/BrandHeader";
import { EmptyState } from "@/molecules/EmptyState";
import { StatusRow } from "@/molecules/StatusRow";
import { FindingsList, type FindingItem } from "@/organisms/FindingsList";
import { WorldList } from "@/organisms/WorldList";
import { PanelTabs } from "@/molecules/PanelTabs";
import type { WorldFilter } from "@/helpers/world";
import { SourcePrompt } from "@/organisms/SourcePrompt";
import { SignInPanel } from "@/organisms/SignInPanel";
import { formatNumber, formatShortDate } from "@/utils/format";

export const VIEW_TYPE = "bunsho-continuity";
export const UPGRADE_URL = "https://bunsho.io/#pricing";

const STAGE_LABEL: Record<string, string> = {
  read: "reading your story", cast: "finding the cast", search: "searching the book", triage: "sorting leads",
  judge: "weighing contradictions", timeline: "checking the timeline", names: "checking names", canon: "checking canon",
  assemble: "writing up findings",
};

export class ContinuityView extends ItemView {
  private showDismissed = false;
  private readonly expanded = new Set<string>();
  private tab: "findings" | "world" = "findings";
  private worldFilter: WorldFilter = "people";
  private worldSearch = "";
  private readonly worldOpen = new Set<string>();
  private readonly worldHistory = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private readonly controller: ContinuityController) { super(leaf); }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Bunsho"; }
  getIcon(): string { return BUNSHO_ICON_ID; }

  async onOpen(): Promise<void> { this.render(); await this.controller.refresh(); }

  render(): void {
    const root = this.contentEl;
    // A re-render must not take the cursor out of the World search while the writer types.
    const searching = root.querySelector(".bunsho-world-search") === root.ownerDocument.activeElement;
    const scroll = root.scrollTop;
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
    if (!this.renderAlert(body)) this.renderContent(body);
    // Like the desktop's Continuity tab: one quiet line, always there, never a popup.
    AiNotice(root);
    root.scrollTop = scroll;
    if (searching) root.querySelector<HTMLInputElement>(".bunsho-world-search")?.focus();
  }

  private renderContent(body: HTMLElement): void {
    const c = this.controller;
    const { scan } = c;
    if (scan.status === "ready") {
      this.renderSource(body, scan.source.kind === "folder" && scan.source.path === "/" ? "Whole vault" : scan.source.path);
      PanelTabs(body, { active: this.tab, onSelect: (tab) => { this.tab = tab; this.render(); }, tabs: [{ id: "findings", label: "Findings" }, { id: "world", label: "World" }] });
      if (this.tab === "world") this.renderWorld(body); else this.renderFindings(body);
      return;
    }
    SourcePrompt(body, { scan, onChoose: () => void c.chooseSource() });
  }

  /** What is being read, and the way to change it. */
  private renderSource(body: HTMLElement, name: string): void {
    const c = this.controller;
    const row = body.createDiv({ cls: "bunsho-source" });
    Fact(row, `Reading ${name}`, "bunsho-source-name");
    const actions = row.createSpan({ cls: "bunsho-actions" });
    const busy = c.phase.kind === "checking" || c.phase.kind === "preparing" || c.phase.kind === "confirming";
    if (busy) return;
    TextAction(actions, { label: "Reading plan", quiet: true, onClick: () => void c.editPlan() });
    TextAction(actions, { label: "Change", quiet: true, onClick: () => void c.chooseSource() });
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
      StatusRow(root, { fact: phase.kind === "preparing" ? "reading your notes…" : "waiting for you to confirm" });
      return;
    }
    if (scan.status !== "ready") { StatusRow(root, { fact: "Nothing to check yet" }); return; }

    const review = c.currentReview();
    const sources = scan.items.filter((item) => item.included).length;
    const parts = [`${formatNumber(sources)} ${c.noun(sources)}`, `${formatNumber(scan.words)} words`];
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
      const card = AlertCard(body, { title: "One project on the free plan",
        body: `Your free project is \u201c${account.registeredName ?? "your other manuscript"}\u201d. You can switch it to this vault at any time, or upgrade to check both.` });
      const actions = card.createDiv({ cls: "bunsho-alert-actions" });
      FillButton(actions, { label: "Use this vault instead", onClick: () => void c.replaceFreeProject() });
      QuietButton(actions, { label: "See plans", onClick: () => window.open(UPGRADE_URL) });
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
        body: "Bunsho reads your story and shows where it contradicts itself, quoting both passages. You see the order and the price before anything is spent." });
      if (c.phase.kind === "idle" || c.phase.kind === "error") FillButton(box, { label: this.checkLabel(), onClick: () => void c.check() });
      return;
    }
    const dismissed = new Set(c.data.dismissed);
    const pages = new Map(review.pages.map((page) => [page.pageId, page]));
    const toItem = (issue: EngineIssue): FindingItem => ({
      id: issue.issue_id,
      claim: issue.message,
      severity: issue.severity,
      passages: issue.citations.filter((ct) => ct.evidence_role !== "supporting_context").map((ct) => ({
        quote: ct.quoted_text, coordinate: this.coordinate(ct, pages, true), shortCoordinate: this.coordinate(ct, pages, false),
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
      coverage: { read: review.coverage.sources.length - review.coverage.unreadSources.length, total: review.coverage.sources.length, excluded: review.coverage.excluded,
        noun: c.noun(review.coverage.sources.length), unreadLabels: review.coverage.sources.filter((source) => review.coverage.unreadSources.includes(source.id)).map((source) => source.label) },
      showDismissed: this.showDismissed,
      onToggleShowDismissed: () => { this.showDismissed = !this.showDismissed; this.render(); },
    });
  }

  private renderWorld(body: HTMLElement): void {
    const c = this.controller;
    const entities = c.worldEntities();
    if (!entities) {
      const box = EmptyState(body, { title: "Your story's world",
        body: "After a check, Bunsho lists your people, places and things, with the passage each fact comes from. It costs nothing extra." });
      if (c.phase.kind === "idle" || c.phase.kind === "error") FillButton(box, { label: this.checkLabel(), onClick: () => void c.check() });
      return;
    }
    const toggle = (set: Set<string>, id: string) => { if (!set.delete(id)) set.add(id); this.render(); };
    WorldList(body, {
      entities, filter: this.worldFilter, search: this.worldSearch, expanded: this.worldOpen, history: this.worldHistory,
      isStale: (row) => c.isStale(row),
      onFilter: (filter) => { this.worldFilter = filter; this.render(); },
      onSearch: (search) => { this.worldSearch = search; this.render(); },
      onToggle: (id) => toggle(this.worldOpen, id),
      onToggleHistory: (id) => toggle(this.worldHistory, id),
      onGo: (row) => void c.jumpToFact(row),
    });
  }

  private checkLabel(): string {
    const price = this.controller.price();
    return price === null ? "Check manuscript" : `Check manuscript · ~${formatNumber(price)} credits`;
  }

  /** Where a passage is, in the writer's terms: the note or section. Reading units are never shown. */
  private coordinate(citation: EngineIssueCitation, pages: Map<string, PageMeta>, full: boolean): string {
    const page = pages.get(citation.page_id);
    if (!page) return citation.location_label;
    return full ? page.label : page.label.split(" / ").pop() ?? page.label;
  }
}
