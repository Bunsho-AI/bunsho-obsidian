/**
 * The Director tab (the desktop's SceneDirectorTab): the writer directs, Bunsho drafts. Top to bottom: the direction, the scene card, the draft, then earlier scenes. Only Keep reaches the
 * page: the draft lives here until then, and nothing runs a check by itself. Every control that spends credits says its price on itself; a price the engine did not give leaves the control
 * resting, because the price is the consent. Editing the card is free. There is no stop control, as on the desktop.
 */
import type { ContinuityController } from "@/controllers/ContinuityController";
import type { DirectorController, SceneAnchorInput, SceneFailure, ScenePlacement } from "@/controllers/DirectorController";
import { directionOf, type DirectorSceneRecord, type EditedBeat } from "@/helpers/director/sceneCard";
import { exampleDirection, FAILED_COPY, isKeptScene, layoutScenes, NO_CHAPTER, passagesOf, rowStatus, scenePageId, titleOf, writingStepMs, type DraftPassage, type NoteSlotKind, type SceneOp } from "@/helpers/director/sceneView";
import type { EngineBeat } from "@/lib/contract/director.types";
import { CardShape } from "@/molecules/CardShape";
import type { SceneAnchorLineProps } from "@/molecules/SceneAnchorLine";
import { SceneFailureLine } from "@/molecules/SceneFailureLine";
import { SceneNoteSlot } from "@/molecules/SceneNoteSlot";
import { EarlierScenesHead, SceneRow } from "@/molecules/SceneRow";
import { DirectionBox, DirectionWell } from "@/organisms/DirectionBox";
import { DraftFoot } from "@/organisms/DraftFoot";
import { DirectorUpsell } from "@/organisms/DirectorUpsell";
import { SceneCard, type BeatEditState, type SceneCardMode, type SceneCardNotice } from "@/organisms/SceneCard";
import { SceneDraft } from "@/organisms/SceneDraft";

export interface DirectorTabHost {
  redraw(focusKey?: string): void;
  /** While true the panel holds its redraws: an IME composition or a drag would end. */
  composing(composing: boolean): void;
  openBilling(): void;
}

const QUILL_TIER = "quill";
/** The earlier try's answer is gone, and it may have stayed charged. Said because the next press is a new charge. */
const REPLAYED = " That try may already have been charged, and pressing again is a new charge.";
const NEEDS_FULL_REVIEW = "Check the whole manuscript first: a chapter can only be checked against a book Bunsho has read.";

export class DirectorTab {
  /** A reopened scene's id, "none" once the card is folded away, or null for the default: the newest, unkept. */
  private focus: string | null = null;
  private direction = "";
  private editingDirection = false;
  private newPlacement: ScenePlacement = "append";
  private cardPlacement: ScenePlacement | null = null;
  private placementOpen = false;
  private notice: SceneCardNotice | null = null;
  private planFailure: { message: string; charged: number | null } | null = null;
  private sceneSlotOpen = false;
  private beatSlot: string | null = null;
  private rewriteSlot: string | null = null;
  private slotNote = "";
  private editing: BeatEditState | null = null;
  private removed: { beatId: string; line: string; index: number } | null = null;
  private litBeat: number | null = null;
  private beatsUnfolded = false;
  private writingBeat: number | null = null;
  private writingTimer: number | undefined;
  private draftMessage: string | null = null;
  private keptNote: string | null = null;
  private checking: string | null = null;
  private currentId: string | null = null;
  private root: HTMLElement | null = null;
  /** The chapter the panel last named: what a paid action means, whatever the cursor has done since. */
  private shownChapter: string | null = null;

  constructor(private readonly director: DirectorController, private readonly continuity: ContinuityController, private readonly host: DirectorTabHost) {}

  /** Stops what the tab left running. */
  dispose(): void { this.stopWriting(); }

  /** Another book or account: nothing of the last one carries over. */
  reset(): void {
    this.stopWriting();
    this.focus = null;
    this.direction = "";
    this.editingDirection = false;
    this.newPlacement = "append";
    this.planFailure = null;
    this.keptNote = null;
    this.checking = null;
    this.startClean();
    this.currentId = null;
  }

  private startClean(): void {
    this.sceneSlotOpen = false;
    this.beatSlot = null;
    this.rewriteSlot = null;
    this.slotNote = "";
    this.editing = null;
    this.removed = null;
    this.litBeat = null;
    this.beatsUnfolded = false;
    this.notice = null;
    this.draftMessage = null;
    this.cardPlacement = null;
    this.placementOpen = false;
  }

  /** The cursor moved to another chapter since the panel last drew: true when it should draw again. */
  chapterMoved(): boolean { return (this.continuity.activeChapter()?.id ?? null) !== this.shownChapter; }

  private chapterTitle(id: string | null | undefined): string { return (id ? this.director.chapters()[id]?.title : undefined) ?? "this chapter"; }

  private anchorOf(itemId: string, placement: ScenePlacement): SceneAnchorInput { return { itemId, placement }; }

  /** The card as the writer left it: a line still open in its field and a removal still undoable are part of what is paid for. Undefined when nothing changed. */
  private settle(scene: DirectorSceneRecord): EditedBeat[] | undefined {
    const removed = this.removed;
    let beats: EditedBeat[] = scene.beats.filter((b) => b.beatId !== removed?.beatId).map((b) => ({ beatId: b.beatId, intent: b.intent }));
    let changed = Boolean(removed);
    const { editing } = this;
    const value = editing?.value.trim() ?? "";
    if (editing && value) {
      if (editing.beatId === undefined) { beats = [...beats, { intent: value }]; changed = true; }
      else if (beats.some((b) => b.beatId === editing.beatId && b.intent !== value)) { beats = beats.map((b) => (b.beatId === editing.beatId ? { ...b, intent: value } : b)); changed = true; }
    }
    this.editing = null;
    this.removed = null;
    return changed ? beats : undefined;
  }

  private failureNotice(failure: SceneFailure, op: SceneOp, action: "Planning" | "Writing", needed: number | null): SceneCardNotice | null {
    if (failure.kind === "credits") return { kind: "outOfCredits", action, needed, balance: this.continuity.account.balance };
    if (failure.kind === "failed") return { kind: "failed", message: `${FAILED_COPY[op]}${failure.replayed ? REPLAYED : ""}`, charged: failure.charged };
    return failure.message ? { kind: "failed", message: failure.message, charged: null } : null;
  }

  private async plan(): Promise<void> {
    const text = this.direction.trim();
    if (!text) return;
    const chapter = this.shownChapter;
    if (!chapter) { this.planFailure = { message: NO_CHAPTER, charged: null }; this.host.redraw("direction:field"); return; }
    this.planFailure = null;
    const result = await this.director.plan(text, this.anchorOf(chapter, this.newPlacement));
    if (result.ok) {
      this.focus = null;
      this.direction = "";
      this.host.redraw("scene:write");
      return;
    }
    const { failure } = result;
    if (failure.kind === "credits") this.planFailure = { message: "Out of credits. Nothing was charged.", charged: null };
    else if (failure.kind === "failed") this.planFailure = { message: `${FAILED_COPY.plan}${failure.replayed ? REPLAYED : ""}`, charged: failure.charged };
    else if (failure.message) this.planFailure = { message: failure.message, charged: null };
    this.host.redraw("direction:field");
  }

  private async regenerate(scene: DirectorSceneRecord, itemId: string, placement: ScenePlacement, input: { note?: string; direction?: string }): Promise<void> {
    this.sceneSlotOpen = false;
    this.notice = null;
    const edits = this.settle(scene);
    const result = await this.director.regenerate({ sceneId: scene.sceneId, ...input, anchor: this.anchorOf(itemId, placement), edits });
    if (result.ok) { this.editingDirection = false; this.direction = ""; }
    else this.notice = this.failureNotice(result.failure, "regenerate", "Planning", this.director.planPrice);
    this.host.redraw("scene:regenerate");
  }

  private async regenerateBeat(scene: DirectorSceneRecord, beat: EngineBeat, itemId: string, placement: ScenePlacement, note: string): Promise<void> {
    this.beatSlot = null;
    this.notice = null;
    const edits = this.settle(scene);
    const result = await this.director.regenerateBeat({ sceneId: scene.sceneId, beatId: beat.beatId, ...(note ? { note } : {}), anchor: this.anchorOf(itemId, placement), edits });
    if (!result.ok) this.notice = this.failureNotice(result.failure, "regenerateBeat", "Planning", this.director.planPrice);
    this.host.redraw(`beat:${beat.beatId}:regenerate`);
  }

  private async commitEdit(scene: DirectorSceneRecord, onShow: readonly EngineBeat[]): Promise<void> {
    const { editing } = this;
    if (!editing || this.director.busy) return;
    const value = editing.value.trim();
    this.editing = null;
    const base: EditedBeat[] = onShow.map((b) => ({ beatId: b.beatId, intent: b.intent }));
    let next: EditedBeat[];
    if (editing.beatId === undefined) {
      if (!value) { this.host.redraw("beat:add"); return; }
      next = [...base, { intent: value }];
    } else {
      const prior = onShow.find((b) => b.beatId === editing.beatId);
      if (!prior || !value || value === prior.intent) { this.host.redraw(`beat:${editing.beatId}:line`); return; }
      next = base.map((b) => (b.beatId === editing.beatId ? { ...b, intent: value } : b));
    }
    this.removed = null;
    await this.saveBeats(scene, next);
    this.host.redraw(editing.beatId ? `beat:${editing.beatId}:line` : "beat:add");
  }

  private async saveBeats(scene: DirectorSceneRecord, beats: EditedBeat[]): Promise<void> {
    const result = await this.director.editBeats(scene.sceneId, beats);
    if (result.ok) { if (this.notice?.kind !== "discarded") this.notice = null; }
    else if (result.failure.kind === "input" && result.failure.message) this.notice = { kind: "failed", message: result.failure.message, charged: null };
  }

  private async removeBeat(scene: DirectorSceneRecord, beat: EngineBeat): Promise<void> {
    if (this.director.busy) return;
    // A second removal makes the first one real: the undo line holds one beat.
    const edits = this.removed ? this.settle(scene) : undefined;
    if (edits) await this.saveBeats(scene, edits);
    const beats = this.director.scenes.find((s) => s.sceneId === scene.sceneId)?.beats ?? scene.beats;
    const at = beats.findIndex((b) => b.beatId === beat.beatId);
    this.removed = { beatId: beat.beatId, line: beat.intent, index: at };
    this.host.redraw("beat:undo");
  }

  private async reorder(scene: DirectorSceneRecord, onShow: readonly EngineBeat[], from: number, to: number): Promise<void> {
    if (this.director.busy) return;
    const beats: EditedBeat[] = onShow.map((b) => ({ beatId: b.beatId, intent: b.intent }));
    const [moved] = beats.splice(from, 1);
    beats.splice(to, 0, moved);
    this.removed = null;
    await this.saveBeats(scene, beats);
    this.host.redraw(`beat:${moved.beatId ?? ""}:grip`);
  }

  private startWriting(count: number): void {
    this.stopWriting();
    this.writingBeat = 1;
    this.writingTimer = window.setInterval(() => {
      this.writingBeat = Math.min(count, (this.writingBeat ?? 0) + 1);
      this.host.redraw();
    }, writingStepMs(count));
  }

  private stopWriting(): void { window.clearInterval(this.writingTimer); this.writingTimer = undefined; this.writingBeat = null; }

  private async write(scene: DirectorSceneRecord, itemId: string, placement: ScenePlacement): Promise<void> {
    this.notice = null;
    this.sceneSlotOpen = false;
    this.beatSlot = null;
    const edits = this.settle(scene);
    this.startWriting(edits?.length ?? scene.beats.length);
    const result = await this.director.write({ sceneId: scene.sceneId, anchor: this.anchorOf(itemId, placement), edits });
    this.stopWriting();
    if (!result.ok) {
      const beats = this.director.scenes.find((s) => s.sceneId === scene.sceneId)?.beats.length ?? scene.beats.length;
      this.notice = this.failureNotice(result.failure, "write", "Writing", this.director.beatPrice !== null ? this.director.beatPrice * beats : null);
    }
    this.host.redraw(result.ok ? "draft:keep" : "scene:write");
  }

  private async rewrite(scene: DirectorSceneRecord, passage: DraftPassage, note: string): Promise<void> {
    this.rewriteSlot = null;
    this.draftMessage = null;
    const result = await this.director.rewriteBeat({ sceneId: scene.sceneId, beatId: passage.beatId, beatOrder: passage.beatOrder, ...(note ? { note } : {}) });
    if (!result.ok) {
      const { failure } = result;
      if (failure.kind === "credits") this.draftMessage = "Out of credits. Nothing was charged. The draft stays as it is.";
      else if (failure.kind === "failed") this.draftMessage = `${FAILED_COPY.rewrite}${failure.replayed ? REPLAYED : ""}${failure.charged === 0 ? " Nothing was charged." : failure.charged ? ` ${failure.charged.toLocaleString("en-US")} credits were charged.` : ""}`;
      else if (failure.message) this.draftMessage = failure.message;
    }
    this.host.redraw(`rewrite:${passage.beatId}`);
  }

  private async keep(scene: DirectorSceneRecord): Promise<void> {
    this.draftMessage = null;
    const result = await this.director.keep(scene.sceneId, (id) => this.chapterTitle(id));
    if (result.ok) { this.focus = null; this.keptNote = result.note; this.host.redraw("check:offer"); return; }
    if (result.message) this.draftMessage = result.message;
    this.host.redraw("draft:keep");
  }

  private async discard(scene: DirectorSceneRecord): Promise<void> {
    const result = await this.director.discard(scene.sceneId);
    if (result.ok) this.notice = { kind: "discarded" };
    else if (result.failure.kind === "input" && result.failure.message) this.draftMessage = result.failure.message;
    this.host.redraw("scene:write");
  }

  private async togglePrevious(scene: DirectorSceneRecord): Promise<void> {
    await this.director.swapPrevious(scene.sceneId, this.settle(scene));
    this.host.redraw("scene:previous");
  }

  private async runCheck(scene: DirectorSceneRecord, itemId: string, quoted: number): Promise<void> {
    this.checking = scene.sceneId;
    this.host.redraw();
    const before = this.continuity.currentReview()?.checkedAt;
    await this.continuity.checkChapter(itemId, quoted);
    this.checking = null;
    // A check that did not run keeps its offer, and the panel says why when there is a why.
    if (this.continuity.phase.kind !== "error" && this.continuity.currentReview()?.checkedAt !== before) await this.director.dismissCheckOffer(scene.sceneId);
    this.host.redraw("direction:field");
  }

  private slot(kind: NoteSlotKind, price: number | null, focusKey: string, submit: (note: string) => void, cancel: () => void): (parent: HTMLElement) => void {
    return (parent) => SceneNoteSlot(parent, { kind, price, note: this.slotNote, focusKey, onNote: (note) => { this.slotNote = note; }, onComposing: (composing) => this.host.composing(composing),
      onSubmit: () => { const note = this.slotNote.trim(); this.slotNote = ""; submit(note); }, onCancel: () => { this.slotNote = ""; cancel(); } });
  }

  private anchorLine(placement: ScenePlacement, title: string, onChange?: (placement: ScenePlacement) => void): SceneAnchorLineProps {
    return { placement, chapterTitle: title, focusKey: "anchor:place", ...(onChange ? { open: this.placementOpen, onToggle: () => { this.placementOpen = !this.placementOpen; this.host.redraw("anchor:place"); },
      onPlacementChange: (next) => { this.placementOpen = false; onChange(next); this.host.redraw("anchor:place"); } } : {}) };
  }

  render(body: HTMLElement): void {
    const c = this.continuity;
    const d = this.director;
    if (c.account.tier === QUILL_TIER) { DirectorUpsell(body, { onUpgrade: () => this.host.openBilling() }); return; }
    d.ensureLoaded();
    if (!d.loaded) return;
    const root = body.createDiv({ cls: "bunsho-director" });
    this.root = root;
    const active = c.activeChapter();
    this.shownChapter = active?.id ?? null;
    const scenes = d.visibleScenes();
    const chapters = d.chapters();
    const layout = layoutScenes(scenes, this.focus);
    const { current, justKept } = layout;
    if ((current?.sceneId ?? null) !== this.currentId) { this.currentId = current?.sceneId ?? null; this.startClean(); }
    const currentKept = current ? isKeptScene(current) : false;
    const currentWritten = Boolean(current?.draft) || currentKept;
    const anchorId = current ? (currentWritten ? current.anchor.pageId : active?.id ?? current.anchor.pageId) : active?.id ?? null;
    const placement = current ? this.cardPlacement ?? current.anchor.placement : this.newPlacement;
    const { busy } = d;
    const planning = busy === "plan";
    const showBox = !current || this.editingDirection || currentKept;
    const inDraft = Boolean(current?.draft) && !currentKept;
    const mode: SceneCardMode = currentKept ? "readOnly" : inDraft ? "draft" : busy === "write" ? "writing" : busy === "regenerate" ? "regenerating" : "unwritten";
    const anyKept = scenes.some(isKeptScene);
    const cast = c.directorCast();
    const planPrice = d.planPrice;
    const anchorLine = this.anchorLine(placement, this.chapterTitle(anchorId), current && (currentWritten || busy) ? undefined : (next) => { if (current) this.cardPlacement = next; else this.newPlacement = next; });
    const newAnchor = this.anchorLine(this.newPlacement, this.chapterTitle(active?.id), (next) => { this.newPlacement = next; });

    if (showBox && !planning) {
      DirectionBox(root, { value: this.direction, placeholder: exampleDirection(cast, anyKept && !this.editingDirection), planPrice, anchor: this.editingDirection ? anchorLine : newAnchor, cast, busy: busy !== null,
        onChange: (value) => { this.direction = value; }, onComposing: (composing) => this.host.composing(composing),
        onPlan: () => { if (this.editingDirection && current && anchorId) void this.regenerate(current, anchorId, placement, { direction: this.direction.trim() }); else void this.plan(); },
        onCancelEdit: this.editingDirection ? () => { this.editingDirection = false; this.direction = ""; this.host.redraw("direction:edit"); } : undefined });
    } else if (planning || (current && !showBox && !inDraft)) {
      DirectionWell(root, { value: planning ? this.direction : current ? directionOf(current) : "",
        onEdit: current && mode === "unwritten" && !planning ? () => { this.direction = directionOf(current); this.editingDirection = true; this.host.redraw("direction:field"); } : undefined });
    }
    if (this.planFailure) SceneFailureLine(root, this.planFailure);
    if (planning) CardShape(root);

    if (justKept && !planning) {
      const itemId = scenePageId(justKept);
      const quote = c.chapterQuote(itemId);
      const running = this.checking === justKept.sceneId;
      SceneRow(root, { framed: true, title: titleOf(justKept), status: "kept", focusKey: `scene:${justKept.sceneId}`, chapterOrdinal: chapters[itemId]?.ordinal, chapterTitle: this.chapterTitle(itemId), checkOffer: true,
        checkPrice: quote, checking: running, checkHint: quote === null ? NEEDS_FULL_REVIEW : null,
        onOpen: busy ? undefined : () => { this.focus = justKept.sceneId; this.host.redraw("scene:fold"); },
        onCheck: quote !== null && !c.busy ? () => void this.runCheck(justKept, itemId, quote) : undefined,
        onDismissCheck: () => { void d.dismissCheckOffer(justKept.sceneId).then(() => this.host.redraw("direction:field")); } });
    }
    if (this.keptNote && justKept && !planning) root.createDiv({ cls: "bunsho-small", text: this.keptNote, attr: { role: "status" } });

    if (current && !planning) this.renderCard(root, current, mode, anchorLine, anchorId, placement);
    if (inDraft && current?.draft) this.renderDraft(root, current);

    if (layout.earlier.length > 0 && !inDraft) {
      EarlierScenesHead(root, layout.earlier.length);
      for (const scene of layout.earlier) {
        SceneRow(root, { title: titleOf(scene), status: rowStatus(scene), focusKey: `scene:${scene.sceneId}`, chapterOrdinal: chapters[scenePageId(scene)]?.ordinal, onOpen: busy ? undefined : () => { this.focus = scene.sceneId; this.host.redraw("scene:fold"); } });
      }
    }
    if (inDraft && current?.draft) {
      DraftFoot(root, { anchor: { placement: current.anchor.placement, chapterTitle: this.chapterTitle(current.anchor.pageId), trailing: `${current.draft.wordCount.toLocaleString("en-US")} words` }, keeping: busy === "keep", locked: busy !== null, message: this.draftMessage,
        onKeep: () => void this.keep(current), onDiscard: () => void this.discard(current) });
    }
  }

  private renderCard(root: HTMLElement, current: DirectorSceneRecord, mode: SceneCardMode, anchor: SceneAnchorLineProps, anchorId: string | null, placement: ScenePlacement): void {
    const d = this.director;
    const itemId = anchorId ?? current.anchor.pageId;
    const beats = mode === "readOnly" || mode === "draft" ? current.beats : current.beats.filter((b) => b.beatId !== this.removed?.beatId);
    const beatSlot = this.beatSlot;
    const slotBeat = beatSlot ? current.beats.find((b) => b.beatId === beatSlot) : undefined;
    SceneCard(root, {
      scene: current, chapters: d.chapters(), mode, anchor, prices: { plan: d.planPrice, perBeat: d.beatPrice }, beats, removed: this.removed, editing: this.editing, writingBeat: this.writingBeat, litBeat: this.litBeat,
      regeneratingBeatId: d.regeneratingBeatId, notice: this.notice, beatsUnfolded: this.beatsUnfolded, locked: d.busy !== null,
      beatSlot: slotBeat ? { beatId: slotBeat.beatId, draw: this.slot("beat", d.planPrice, `slot:${slotBeat.beatId}`, (note) => void this.regenerateBeat(current, slotBeat, itemId, placement, note), () => { this.beatSlot = null; this.host.redraw(`beat:${slotBeat.beatId}:regenerate`); }) } : null,
      sceneSlot: this.sceneSlotOpen ? this.slot("scene", d.planPrice, "slot:scene", (note) => void this.regenerate(current, itemId, placement, note ? { note } : {}), () => { this.sceneSlotOpen = false; this.host.redraw("scene:regenerate"); }) : null,
      onHoverBeat: (order) => this.hover(order),
      onStartEdit: (beat) => { this.editing = { beatId: beat.beatId, value: beat.intent }; this.host.redraw(`beat:${beat.beatId}:field`); },
      onStartAdd: () => { this.editing = { value: "" }; this.host.redraw("beat:new:field"); },
      onEditChange: (value) => { if (this.editing) this.editing = { ...this.editing, value }; },
      onEditCommit: () => void this.commitEdit(current, beats),
      onEditCancel: () => { const id = this.editing?.beatId; this.editing = null; this.host.redraw(id ? `beat:${id}:line` : "beat:add"); },
      onComposing: (composing) => this.host.composing(composing),
      onRemove: (beat) => void this.removeBeat(current, beat),
      onUndoRemove: () => { this.removed = null; this.host.redraw("beat:add"); },
      onReorder: (from, to) => void this.reorder(current, beats, from, to),
      onOpenBeatSlot: (beat) => { this.slotNote = ""; this.beatSlot = beat.beatId; this.host.redraw(`slot:${beat.beatId}`); },
      onOpenRegenerate: () => { this.slotNote = ""; this.sceneSlotOpen = true; this.host.redraw("slot:scene"); },
      onWrite: () => void this.write(current, itemId, placement),
      onTogglePrevious: () => void this.togglePrevious(current),
      onToggleBeats: () => { this.beatsUnfolded = !this.beatsUnfolded; this.host.redraw("scene:beats"); },
      onFold: () => { this.focus = "none"; this.host.redraw("direction:field"); },
      onOpenBilling: () => this.host.openBilling(),
      onDragging: (dragging) => this.host.composing(dragging),
    });
  }

  private renderDraft(root: HTMLElement, current: DirectorSceneRecord): void {
    if (!current.draft) return;
    const d = this.director;
    const passages = passagesOf(current.draft);
    const slotPassage = this.rewriteSlot ? passages.find((p) => p.beatId === this.rewriteSlot) : undefined;
    SceneDraft(root, { passages, litBeat: this.litBeat, rewritePrice: d.beatPrice, rewritingBeat: d.rewritingBeat, onHoverBeat: (order) => { if (!this.rewriteSlot) this.hover(order); },
      onRewrite: d.busy ? undefined : (passage) => { this.slotNote = ""; this.rewriteSlot = passage.beatId; this.host.redraw(`slot:${passage.beatId}`); },
      slot: slotPassage ? { beatId: slotPassage.beatId, draw: this.slot("rewrite", d.beatPrice, `slot:${slotPassage.beatId}`, (note) => void this.rewrite(current, slotPassage, note), () => { this.rewriteSlot = null; this.host.redraw(`rewrite:${slotPassage.beatId}`); }) } : null });
  }

  /** Lights a beat and its passage. By class alone: a redraw under the pointer would lose a click. */
  private hover(order: number | null): void {
    this.litBeat = order;
    const root = this.root;
    if (!root) return;
    for (const passage of Array.from(root.querySelectorAll<HTMLElement>("[data-passage]"))) passage.toggleClass("is-lit", order !== null && passage.dataset.passage === String(order));
    for (const row of Array.from(root.querySelectorAll<HTMLElement>("[data-scene-card=\"folded\"] [data-beat-row]"))) row.toggleClass("is-lit", order !== null && row.dataset.beatRow === String(order));
  }
}
