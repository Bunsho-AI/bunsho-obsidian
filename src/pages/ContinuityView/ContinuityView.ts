/**
 * The Bunsho panel (an Obsidian view). The only UI layer that reads the controller: it turns state into props for the
 * organisms below. Mirrors the desktop Continuity tab; colours follow the writer's theme (see styles.css).
 */
import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import { BUNSHO_ICON_ID } from "@/assets/logo";
import { FillButton } from "@/atoms/FillButton";
import type { ContinuityController, RecheckResult } from "@/controllers/ContinuityController";
import { QuietButton } from "@/atoms/QuietButton";
import { TextAction } from "@/atoms/TextAction";
import { Fact } from "@/atoms/Fact";
import type { PageMeta } from "@/helpers/sources";
import type { ReviewOutcome } from "@/helpers/reviewMerge";
import type { StoppedReview } from "@/types";
import type { CanonTarget } from "@/helpers/canon/pen";
import type { EngineIssue, EngineIssueCitation } from "@/lib/contract/engine.types";
import { AlertCard } from "@/molecules/AlertCard";
import { BrandHeader } from "@/molecules/BrandHeader";
import { EmptyState } from "@/molecules/EmptyState";
import { PanelFoot } from "@/molecules/PanelFoot";
import { StatusRow } from "@/molecules/StatusRow";
import { accountSummary } from "@/helpers/account";
import { cardEvidence, displayOrder, nextOpenIssue, railEvidence, resolutionOf, resolverContext } from "@/helpers/findings";
import { filterBySpectrum, orderSpectrumByCount, type SpectrumKey } from "@/helpers/spectrum";
import { ChangedChaptersRow } from "@/molecules/ChangedChaptersRow";
import { CheckChapterControl } from "@/molecules/CheckChapterControl";
import { SpectrumChips } from "@/molecules/SpectrumChips";
import { FindingsList, type FindingItem, type ResolvedItem } from "@/organisms/FindingsList";
import { ResolverPanel, type ResolverPanelProps } from "@/organisms/ResolverPanel";
import { WorldList } from "@/organisms/WorldList";
import { PanelTabs } from "@/molecules/PanelTabs";
import { PANEL_TABS, type PanelTabId } from "@/helpers/panelTabs";
import { worldChanges, type WorldEntity, type WorldFilter } from "@/helpers/world";
import { lapsedTitle } from "@/helpers/account";
import { PEN_FAILURE_COPY, WorldPen } from "@/pages/ContinuityView/WorldPen";
import { DirectorTab } from "@/pages/ContinuityView/DirectorTab";
import type { DirectorController } from "@/controllers/DirectorController";
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
  private showResolved = false;
  /** The finding open on the Resolve screen, which takes the panel's place as the desktop's takes the window's. */
  private resolving: string | null = null;
  /** Where the keyboard goes after this render, when the element it was on has gone. */
  private focusNext: string | null = null;
  /** Where the list was when the Resolve screen took its place. */
  private listScroll = 0;
  private scrollNext: number | null = null;
  /** A decision is being saved: the screen's buttons wait for it, as the desktop's do. */
  private settling = false;
  private tab: PanelTabId = "continuity";
  private spectrum: SpectrumKey | null = null;
  /** The price the writer is looking at in Check chapter's confirm. It is what gets sent, whatever a later scan says. */
  private confirming: { id: string; label: string; credits: number } | null = null;
  /** The finding Check if fixed is running for. */
  private rechecking: string | null = null;
  private resolverFeedback: { id: string; tone: "success" | "danger"; message: string } | null = null;
  /** A card Check if fixed closed: said over the list, since its Resolve screen has gone. */
  private listFeedback: string | null = null;
  /** The keyboard goes to Cancel once a review's status row shows it. */
  private focusCancel = false;
  private worldFilter: WorldFilter = "people";
  private worldSearch = "";
  private readonly worldOpen = new Set<string>();
  private readonly worldHistory = new Set<string>();
  /** Which World the open cards belong to: cast ids are only meaningful within one check. */
  private worldShown: readonly WorldEntity[] | null = null;
  private composing = false;
  private renderWaiting = false;
  private resetScroll = false;
  /** What the panel was last about. See the controller's scopeGeneration. */
  private shownScope = 0;
  private readonly pen: WorldPen;
  private readonly directorTab: DirectorTab;
  /** Why a Revert on the Resolve screen did not land. */
  private revertFailure: { id: string; message: string } | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly controller: ContinuityController, director: DirectorController) {
    super(leaf);
    this.directorTab = new DirectorTab(director, controller, {
      redraw: (focusKey) => { if (focusKey) this.focusNext = focusKey; this.render(); },
      composing: (composing) => this.setComposing(composing),
      openBilling: () => window.open(UPGRADE_URL),
    });
    this.pen = new WorldPen(controller, {
      redraw: (focusKey) => { if (focusKey) this.focusNext = focusKey; this.render(); },
      composing: (composing) => this.setComposing(composing),
      expand: (entityId) => { this.worldOpen.add(entityId); },
    });
  }

  private setComposing(composing: boolean): void {
    this.composing = composing;
    if (!composing && this.renderWaiting) { this.renderWaiting = false; this.render(); }
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Bunsho"; }
  getIcon(): string { return BUNSHO_ICON_ID; }

  async onOpen(): Promise<void> {
    // Outside the confirm closes it, as on the desktop. Click, not mousedown: redrawing mid-press would lose the press.
    this.registerDomEvent(this.contentEl.ownerDocument, "click", (event) => {
      if (!this.confirming) return;
      const { target } = event;
      // instanceOf, not instanceof: a panel in a pop-out window has its own HTMLElement.
      if (target instanceof Object && (target as Node).instanceOf?.(HTMLElement) && (target as HTMLElement).isConnected && !(target as HTMLElement).closest(".bunsho-chapter-control")) this.closeConfirm(null);
    });
    // Moving between sections of one note fires nothing, and the Director's line names the chapter a paid action goes to. Before the click, while no press can be lost.
    this.registerDomEvent(this.contentEl, "pointerenter", () => { if (this.tab === "director" && this.directorTab.chapterMoved()) this.render(); });
    this.render();
    await this.controller.refresh();
  }

  async onClose(): Promise<void> { this.directorTab.dispose(); await super.onClose(); }

  /** The writer moved to another note: Check chapter now means that one. */
  activeFileChanged(): void { this.confirming = null; this.render(); }

  /** Check chapter from the command palette: the same confirm as the button. */
  askChapterCheck(): void {
    this.tab = "continuity";
    this.resolving = null;
    this.openConfirm();
  }

  private openConfirm(): void {
    const target = this.controller.chapterTarget();
    if (!target) return;
    this.confirming = target;
    this.focusNext = "chapter:confirm";
    this.render();
  }

  private closeConfirm(focus: string | null): void {
    this.confirming = null;
    if (focus) this.focusNext = focus;
    this.render();
  }

  /** Runs a review from the panel. The keyboard waits on Cancel, then goes to the first of `after` still there, unless the writer has moved on. */
  private async runReview(start: () => Promise<void>, after: () => readonly string[]): Promise<void> {
    this.focusCancel = true;
    this.listFeedback = null;
    this.render();
    await start();
    this.focusCancel = false;
    this.render();
    this.settleFocus(after());
  }

  /** Only when the keyboard is in the panel or nowhere: a writer who went back to their note is left there. */
  private settleFocus(keys: readonly string[]): void {
    const root = this.contentEl;
    const doc = root.ownerDocument;
    const active = doc.activeElement;
    if (active && active !== doc.body && !root.contains(active)) return;
    for (const key of keys) {
      const element = root.querySelector<HTMLElement>(`[data-focus-key="${doc.defaultView?.CSS.escape(key) ?? ""}"]`);
      if (element) { element.focus({ preventScroll: true }); return; }
    }
  }

  render(): void {
    if (this.composing) { this.renderWaiting = true; return; } // rebuilding the field would end the writer's IME composition
    const root = this.contentEl;
    // A re-render must not take the cursor or the keyboard focus away from where the writer is.
    const active = root.ownerDocument.activeElement;
    const search = root.querySelector<HTMLInputElement>(".bunsho-world-search");
    const caret = search && active === search ? [search.selectionStart, search.selectionEnd] as const : null;
    // The pen's fields too: a rescan or an account refresh can arrive while the writer types.
    const penField = active && root.contains(active) && active.classList.contains("bunsho-pen-field") && !this.focusNext ? active as HTMLInputElement : null;
    const penCaret = penField ? [penField.selectionStart, penField.selectionEnd] as const : null;
    const focusKey = this.focusNext ?? (active && root.contains(active) ? active.getAttribute("data-focus-key") : null);
    this.focusNext = null;
    const scroll = this.scrollNext ?? (this.resetScroll ? 0 : root.scrollTop);
    this.scrollNext = null;
    this.resetScroll = false;
    root.empty();
    root.addClass("bunsho-panel");
    const c = this.controller;
    if (c.scopeGeneration !== this.shownScope) {
      this.shownScope = c.scopeGeneration;
      this.pen.reset();
      this.directorTab.reset();
      this.worldSearch = "";
      this.worldOpen.clear();
      this.worldHistory.clear();
      this.resolving = null;
      this.resolverFeedback = null;
      this.listFeedback = null;
      this.revertFailure = null;
      this.confirming = null;
      this.spectrum = null;
    }

    if (!c.account.signedIn) {
      SignInPanel(root, { problem: c.account.problem, onSignIn: () => void c.signIn() });
      return;
    }
    BrandHeader(root, accountSummary(c.account.planName, c.account.balance));
    this.renderStatus(root);
    const body = root.createDiv({ cls: "bunsho-body" });
    if (!this.renderAlert(body)) this.renderContent(body);
    // Like the desktop's Continuity tab: one quiet line, always there, never a popup.
    PanelFoot(root, { onContactSupport: () => c.contactSupport() });
    root.scrollTop = scroll;
    if (caret) {
      const field = root.querySelector<HTMLInputElement>(".bunsho-world-search");
      field?.focus({ preventScroll: true });
      field?.setSelectionRange(caret[0], caret[1]);
    } else if (focusKey) {
      const element = root.querySelector<HTMLElement>(`[data-focus-key="${root.ownerDocument.defaultView?.CSS.escape(focusKey) ?? ""}"]`);
      element?.focus({ preventScroll: true });
      if (penCaret) (element as HTMLInputElement | null)?.setSelectionRange?.(penCaret[0], penCaret[1]);
    }
    if (this.focusCancel && c.phase.kind === "checking") {
      this.focusCancel = false;
      this.settleFocus(["status:cancel"]);
    }
  }

  private renderContent(body: HTMLElement): void {
    const c = this.controller;
    const { scan } = c;
    if (scan.status === "ready") {
      if (this.renderResolver(body)) return;
      this.renderSource(body, scan.source.kind === "folder" && scan.source.path === "/" ? "Whole vault" : scan.source.path);
      PanelTabs(body, { active: this.tab, onSelect: (tab) => { this.tab = tab; this.resetScroll = true; this.render(); }, tabs: PANEL_TABS });
      if (this.tab === "director") this.directorTab.render(body);
      else if (this.tab === "world") this.renderWorld(body);
      else this.renderFindings(body);
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
      StatusRow(root, { fact, reading: true, action: { label: "Cancel", focusKey: "status:cancel", onClick: () => c.cancel() } });
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
    const stopped = c.stoppedReview();
    if (stopped) parts.push(this.stoppedFact(stopped));
    else if (review) parts.push(this.isCurrent(review) ? `checked ${formatShortDate(review.checkedAt)}` : "edited since last check");
    // One priced action: before the first check it is the empty state's button, after it this link.
    const showAction = review !== null && c.account.project !== "blocked";
    StatusRow(root, { fact: parts.join(" · "), action: showAction ? { label: this.checkLabel(), onClick: () => void c.check() } : undefined });
  }

  /** Whether the book is as last checked. Once chapter checks are open that is the ledger's to say, page by page. */
  private isCurrent(review: ReviewOutcome): boolean {
    const c = this.controller;
    const { scan } = c;
    return c.chapterChecksOpen() ? c.changedChapters() === null : scan.status === "ready" && scan.snapshotId === review.snapshotId;
  }

  /** The desktop's status line for a review that did not finish. Counts are plan items, never reading units. */
  private stoppedFact(stopped: StoppedReview): string {
    if (stopped.status === "out_of_credits") return `${stopped.checked}/${stopped.total} reviewed \u00b7 stopped`;
    const gap = Math.min(stopped.total, Math.max(stopped.failed, stopped.total - stopped.checked, 0));
    return `${stopped.checked}/${stopped.total} reviewed \u00b7 ${gap} partial`;
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
      if (phase.action) this.renderReviewFailed(body, phase.message, phase.charged ?? false);
      else AlertCard(body, { title: phase.charged ? "The check stopped" : "The check did not run", body: phase.message });
      return false;
    }
    const stopped = c.stoppedReview();
    if (stopped?.status === "out_of_credits" && (stopped.credits === null || account.balance === null || account.balance < stopped.credits)) {
      // Fixed copy: it answers "did I lose anything?" before the action.
      const card = AlertCard(body, { label: "Out of credits", title: stopped.total > 0 ? `The review stopped at chapter ${stopped.checked} of ${stopped.total}` : undefined,
        body: "Your existing issues are preserved \u2014 nothing was cleared." });
      const actions = card.createDiv({ cls: "bunsho-alert-actions" });
      FillButton(actions, { label: "Open billing", small: true, onClick: () => window.open(UPGRADE_URL) });
      if (account.balance !== null) Fact(actions, `${formatNumber(account.balance)} left`);
      return false;
    }
    if (stopped?.status === "partial" && stopped.message) {
      AlertCard(body, { title: "The review stopped", body: stopped.message, action: { label: "Dismiss", onClick: () => { this.focusNext = c.changedChapters() ? "changed:review" : "tab:continuity"; void c.dismissStopped(); } } });
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

  /** Bunsho's answer to a review that failed: the engine's own words, and the same review again at what it costs now. No Resume: a retry is a new review, and is charged. */
  private renderReviewFailed(body: HTMLElement, message: string, charged: boolean): void {
    const c = this.controller;
    const card = AlertCard(body, { label: "Review failed", body: charged ? `${message} Trying again is charged again.` : message });
    const quote = c.retryQuote();
    // A retry is priced on its button, unless the whole book's own dialog names the price. No price, no button.
    if (quote === null && !(c.phase.kind === "error" && c.phase.action?.kind === "full")) return;
    const actions = card.createDiv({ cls: "bunsho-alert-actions" });
    const retry = actions.createEl("button", { cls: "bunsho-retry", text: quote === null ? "Try again" : `Try again \u00b7 ~${formatNumber(quote)} credits`, attr: { "data-focus-key": "alert:retry" } });
    retry.onclick = () => void this.runReview(() => c.retry(), () => ["alert:retry", "changed:review", "chapter:open", "tab:continuity"]);
  }

  /** What is priced and what is free above the list: changed chapters first, as the desktop's row is, then the check and the picker. */
  private renderLoopTools(body: HTMLElement, open: readonly EngineIssue[], pages: Map<string, PageMeta>): void {
    const c = this.controller;
    if (c.phase.kind === "checking" || c.phase.kind === "preparing" || c.phase.kind === "confirming") { this.confirming = null; return; }
    const changed = c.changedChapters();
    if (changed) {
      const one = changed.count === 1;
      ChangedChaptersRow(body, {
        message: `${formatNumber(changed.count)} ${one ? "chapter has" : "chapters have"} changed since your last check`,
        label: `Review ${formatNumber(changed.count)} changed ${one ? "chapter" : "chapters"} \u00b7 ~${formatNumber(changed.credits)} credits`,
        onReview: () => void this.runReview(() => c.reviewChanged(changed.credits), () => ["changed:review", "chapter:open", "tab:continuity"]),
      });
    }
    const canon = c.canonOffer();
    if (canon) {
      ChangedChaptersRow(body, {
        message: "Your canon changed since the book was last checked against it",
        label: `Check canon \u00b7 ~${formatNumber(canon.credits)} credits`, focusKey: "canon:check",
        onReview: () => void this.runReview(() => c.checkCanon(canon.credits), () => ["canon:check", "changed:review", "chapter:open", "tab:continuity"]),
      });
    }
    const target = c.chapterTarget();
    if (!target && open.length === 0) return;
    const row = body.createDiv({ cls: "bunsho-loop-tools" });
    if (target) {
      CheckChapterControl(row, {
        label: target.label, confirming: this.confirming,
        onOpen: () => { if (this.confirming) this.closeConfirm("chapter:open"); else this.openConfirm(); },
        onCancel: () => this.closeConfirm("chapter:open"),
        onConfirm: () => {
          const { confirming } = this;
          if (!confirming) return;
          this.confirming = null;
          void this.runReview(() => c.checkChapter(confirming.id, confirming.credits), () => ["chapter:open", "tab:continuity"]);
        },
      });
    }
    if (open.length > 0) TextAction(row, { label: "Jump to issue", quiet: true, focusKey: "jump:open", onClick: () => void this.jumpToIssue(open, pages) });
  }

  /** Opens what the writer picks, on its Resolve screen. */
  private async jumpToIssue(open: readonly EngineIssue[], pages: Map<string, PageMeta>): Promise<void> {
    const picked = await this.controller.pickIssue(open, (issue) => { const evidence = cardEvidence(issue); return evidence ? this.coordinate(evidence, pages) : ""; });
    if (picked) this.openResolver(picked.issue_id);
    else this.settleFocus(["jump:open"]);
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
    const deliberate = new Set(c.data.deliberate);
    const fixed = new Set(c.data.fixed);
    const pages = new Map(review.pages.map((page) => [page.pageId, page]));
    const allOpen = displayOrder(review.issues.filter((i) => !resolutionOf(i.issue_id, dismissed, deliberate, fixed)));
    if (allOpen.length === 0) this.spectrum = null;
    const open = filterBySpectrum(allOpen, this.spectrum);
    this.renderLoopTools(body, allOpen, pages);
    if (this.listFeedback) body.createDiv({ cls: "bunsho-feedback is-success", text: this.listFeedback, attr: { role: "status" } });
    SpectrumChips(body, { chips: [...orderSpectrumByCount(allOpen), ...(this.spectrum && open.length === 0 ? [{ key: this.spectrum, count: 0 }] : [])], active: this.spectrum, onSelect: (spectrum) => { this.spectrum = spectrum; this.listFeedback = null; this.render(); } });
    const toItem = (issue: EngineIssue): FindingItem => {
      const evidence = cardEvidence(issue);
      const conflict = c.canonConflict(issue);
      const onDismiss = () => { this.focusNext = this.focusAfter(allOpen, issue.issue_id); void this.decide(() => c.dismiss(issue.issue_id, true)); };
      return {
        ...(conflict ? { canon: { id: issue.issue_id, severity: issue.severity, title: conflict.title, quote: conflict.page.quoted_text, coordinate: conflict.coordinate, factLabel: conflict.factLabel,
          value: conflict.context.pinnedValue, mark: conflict.mark, more: conflict.more.map((extra) => extra.line), factId: conflict.factId, onResolve: () => this.openResolver(issue.issue_id), onDismiss } } : {}),
        id: issue.issue_id,
        claim: issue.message,
        severity: issue.severity,
        quote: evidence?.quoted_text ?? null,
        coordinate: evidence ? this.coordinate(evidence, pages) : "",
        onDismiss,
        onResolve: () => this.openResolver(issue.issue_id),
      };
    };
    const resolved: ResolvedItem[] = review.issues.flatMap((issue) => {
      const status = resolutionOf(issue.issue_id, dismissed, deliberate, fixed);
      return status ? [{ id: issue.issue_id, claim: issue.message, status, onRestore: () => { this.focusNext = `resolve:${issue.issue_id}`; void this.decide(() => c.restoreFinding(issue.issue_id)); } }] : [];
    });
    FindingsList(body, {
      open: open.map(toItem),
      resolved,
      anyFindings: review.issues.length > 0,
      filteredOut: allOpen.length > 0 && open.length === 0,
      coverage: { read: review.coverage.sources.length - review.coverage.unreadSources.length, total: review.coverage.sources.length, excluded: review.coverage.excluded,
        noun: c.noun(review.coverage.sources.length), unreadLabels: review.coverage.sources.filter((source) => review.coverage.unreadSources.includes(source.id)).map((source) => source.label) },
      showResolved: this.showResolved,
      onToggleShowResolved: () => { this.showResolved = !this.showResolved; this.render(); },
    });
  }

  private openResolver(id: string): void {
    if (!this.resolving) this.listScroll = this.contentEl.scrollTop;
    this.resolving = id;
    this.listFeedback = null;
    this.focusNext = "resolver:close";
    this.resetScroll = true;
    this.render();
  }

  private closeResolver(focus: string): void {
    this.resolving = null;
    this.focusNext = focus;
    this.scrollNext = this.listScroll;
    this.render();
  }

  /** Where the keyboard goes when a finding leaves the list: the next one, or the tab when none is left. */
  private focusAfter(open: readonly EngineIssue[], id: string): string {
    const next = nextOpenIssue(open, id);
    return next ? `resolve:${next.issue_id}` : "tab:continuity";
  }

  /** Saves a decision. The controller has taken it back if the save failed; the writer is told. */
  private async decide(action: () => Promise<void>): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (error) {
      console.warn("[Bunsho] could not save a decision", error);
      new Notice("Bunsho could not save that. Try again.");
      return false;
    }
  }

  /** Returns true when the Resolve screen took the panel. A finding a newer check no longer has simply closes it. */
  private renderResolver(body: HTMLElement): boolean {
    if (!this.resolving) return false;
    const c = this.controller;
    const review = c.currentReview();
    const issue = review?.issues.find((i) => i.issue_id === this.resolving);
    const dismissed = new Set(c.data.dismissed);
    const deliberate = new Set(c.data.deliberate);
    const fixed = new Set(c.data.fixed);
    if (!review || !issue || resolutionOf(issue.issue_id, dismissed, deliberate, fixed)) { this.resolving = null; return false; }
    const pages = new Map(review.pages.map((page) => [page.pageId, page]));
    const open = displayOrder(review.issues.filter((i) => !resolutionOf(i.issue_id, dismissed, deliberate, fixed)));
    const next = nextOpenIssue(open, issue.issue_id);
    const id = issue.issue_id;
    const settle = async (action: () => Promise<void>) => {
      this.settling = true;
      this.render();
      const saved = await this.decide(action);
      this.settling = false;
      if (saved && this.resolving === id) this.closeResolver(this.focusAfter(open, id));
      else this.render();
    };
    const conflict = c.canonConflict(issue);
    ResolverPanel(body, {
      claim: issue.message,
      canon: conflict ? { factLabel: conflict.factLabel, value: conflict.context.pinnedValue, mark: conflict.mark, failure: this.revertFailure?.id === id ? this.revertFailure.message : null,
        // A successful Revert leaves the card until the next check, with nothing left to revert.
        onRevert: conflict.pinned && c.penOpen ? () => void this.revertConflict(id, conflict.target) : null } : null,
      passages: railEvidence(issue).map((citation) => ({ quote: citation.quoted_text, coordinate: this.coordinate(citation, pages), onOpen: () => void c.jump(citation) })),
      ...resolverContext(issue),
      busy: this.settling || c.busy,
      recheck: this.recheckProps(id, open),
      feedback: this.resolverFeedback?.id === id ? this.resolverFeedback : null,
      onJump: open.length > 1 ? () => void this.jumpToIssue(open, pages) : null,
      onClose: () => this.closeResolver(`resolve:${id}`),
      onDeliberate: () => void settle(() => c.markDeliberate(id, true)),
      onDismiss: () => void settle(() => c.dismiss(id, true)),
      onNext: next ? () => this.openResolver(next.issue_id) : null,
    });
    return true;
  }

  private async revertConflict(id: string, target: CanonTarget): Promise<void> {
    const result = await this.controller.revertFact(target);
    // Stale: the record is no longer the one shown. The control rests, with no error to read.
    this.revertFailure = result.success || result.code === "STALE_TARGET" || result.code === "NOT_FOUND" ? null : { id, message: PEN_FAILURE_COPY };
    this.focusNext = "resolver:close";
    this.render();
  }

  /** Check if fixed, with its price on it. While one runs the screen stays, and says so. */
  private recheckProps(id: string, open: readonly EngineIssue[]): ResolverPanelProps["recheck"] {
    const c = this.controller;
    const checking = this.rechecking === id;
    const quote = c.recheckQuote(id);
    if (quote === null) return null;
    return { price: `~${formatNumber(quote)} credits`, checking, onClick: () => {
      this.rechecking = id;
      this.resolverFeedback = null;
      const next = this.focusAfter(open, id);
      let result: RecheckResult = { kind: "none", message: "" };
      void this.runReview(async () => {
        result = await c.recheck(id, quote);
        this.rechecking = null;
        if (result.kind === "closed") this.listFeedback = result.message;
        else if (result.kind !== "none") this.resolverFeedback = { id, tone: result.kind === "complete" ? "success" : "danger", message: result.message };
      }, () => (result.kind === "closed" ? [next, "tab:continuity"] : ["resolver:recheck", next, "tab:continuity"]));
    } };
  }

  private renderWorld(body: HTMLElement): void {
    const c = this.controller;
    const found = c.worldEntities();
    const entities = c.worldRecord();
    // Cast ids mean something within one check. A pen write keeps the same check, and the cards stay as the writer left them.
    if (found !== this.worldShown) {
      if (found && this.worldShown) { this.worldOpen.clear(); this.pen.resetCards(); }
      this.worldShown = found;
      this.worldHistory.clear();
    }
    const { lapsed } = c.account;
    const toggle = (set: Set<string>, id: string) => { if (!set.delete(id)) set.add(id); this.render(); };
    const pages = new Map(c.currentReview()?.pages.map((page) => [page.pageId, page.label]));
    WorldList(body, {
      entities, changes: worldChanges(found ?? []), pen: this.pen.slots(), lapsedTitle: lapsed ? lapsedTitle(lapsed) : null, canonProblem: c.canonProblem, onRenew: () => window.open(UPGRADE_URL), coordinate: (pageId) => pages.get(pageId) ?? "another chapter", filter: this.worldFilter, search: this.worldSearch, expanded: this.worldOpen, history: this.worldHistory,
      gaps: c.worldGaps(), factNote: (row) => c.factNote(row),
      onFilter: (filter) => { this.worldFilter = filter; this.resetScroll = true; this.render(); },
      onSearch: (search) => { this.worldSearch = search; },
      onComposing: (composing) => this.setComposing(composing),
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
  private coordinate(citation: EngineIssueCitation, pages: Map<string, PageMeta>): string {
    return pages.get(citation.page_id)?.label ?? citation.location_label;
  }
}
