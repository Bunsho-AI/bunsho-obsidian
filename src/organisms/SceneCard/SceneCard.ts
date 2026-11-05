import { setIcon } from "obsidian";
import { FillButton } from "@/atoms/FillButton";
import type { DirectorSceneRecord } from "@/helpers/director/sceneCard";
import { ADD_BEAT, changeLine, descriptionOf, flaggedBeats, MAX_SCENE_BEATS, price, rankedRecord, recordChapterSentence, titleOf, type DirectorChapterRef } from "@/helpers/director/sceneView";
import type { EngineBeat } from "@/lib/contract/director.types";
import { SceneAnchorLine, type SceneAnchorLineProps } from "@/molecules/SceneAnchorLine";
import { SceneBeatRow, SceneRemovedRow, type BeatRowState } from "@/molecules/SceneBeatRow";
import { SceneFailureLine } from "@/molecules/SceneFailureLine";
import { SceneOutOfCredits } from "@/molecules/SceneOutOfCredits";
import { SceneRecordLine } from "@/molecules/SceneRecordLine";

export type SceneCardMode = "unwritten" | "regenerating" | "writing" | "draft" | "readOnly";
export type SceneCardNotice =
  | { kind: "discarded" }
  | { kind: "failed"; message: string; charged: number | null }
  | { kind: "outOfCredits"; action: "Planning" | "Writing"; needed: number | null; balance: number | null };
export interface BeatEditState { beatId?: string; value: string }

export interface SceneCardProps {
  scene: DirectorSceneRecord;
  chapters: Record<string, DirectorChapterRef>;
  mode: SceneCardMode;
  anchor: SceneAnchorLineProps;
  prices: { plan: number | null; perBeat: number | null };
  beats: EngineBeat[];
  removed: { beatId: string; line: string; index: number } | null;
  editing: BeatEditState | null;
  writingBeat: number | null;
  litBeat: number | null;
  regeneratingBeatId: string | null;
  notice: SceneCardNotice | null;
  beatsUnfolded: boolean;
  locked: boolean;
  /** Draws a note slot where one is open: under the beat, or in the foot. */
  beatSlot: { beatId: string; draw: (parent: HTMLElement) => void } | null;
  sceneSlot: ((parent: HTMLElement) => void) | null;
  onHoverBeat: (order: number | null) => void;
  onStartEdit: (beat: EngineBeat) => void;
  onStartAdd: () => void;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onComposing: (composing: boolean) => void;
  onRemove: (beat: EngineBeat, index: number) => void;
  onUndoRemove: () => void;
  onReorder: (from: number, to: number) => void;
  onOpenBeatSlot: (beat: EngineBeat) => void;
  onOpenRegenerate: () => void;
  onWrite: () => void;
  onTogglePrevious: () => void;
  onToggleBeats: () => void;
  onFold: () => void;
  onOpenBilling: () => void;
  /** A drag has begun or ended: the panel holds its redraws, which would end it. */
  onDragging: (dragging: boolean) => void;
}

function foldedCard(parent: HTMLElement, props: SceneCardProps): void {
  const card = parent.createDiv({ cls: "bunsho-scene-card", attr: { "data-scene-card": "folded" } });
  const head = card.createEl("button", { cls: "bunsho-scene-folded", attr: { "aria-expanded": String(props.beatsUnfolded), "data-focus-key": "scene:beats" } });
  head.createSpan({ cls: "bunsho-scene-row-title is-strong", text: titleOf(props.scene) });
  head.createSpan({ cls: "bunsho-pen", text: props.beatsUnfolded ? "Hide beats" : "Show beats" });
  head.onclick = props.onToggleBeats;
  if (!props.beatsUnfolded) return;
  const rows = card.createDiv({ cls: "bunsho-scene-beats" });
  for (const beat of props.beats) SceneBeatRow(rows, { n: beat.order, line: beat.intent, state: props.litBeat === beat.order ? "lit" : "compact", focusKey: `beat:${beat.beatId}`, onHover: props.onHoverBeat });
}

export function SceneCard(parent: HTMLElement, props: SceneCardProps): void {
  const { scene, mode, beats } = props;
  if (mode === "draft") { foldedCard(parent, props); return; }
  const editable = mode === "unwritten" && !props.locked;
  const card = parent.createDiv({ cls: "bunsho-scene-card", attr: { "data-scene-card": mode } });
  const top = card.createDiv({ cls: mode === "regenerating" ? "is-reading" : "" });
  const head = top.createDiv({ cls: "bunsho-scene-head" });
  if (scene.previous && editable) {
    const row = head.createDiv({ cls: "bunsho-scene-previous" });
    row.createSpan({ cls: "bunsho-small bunsho-scene-note", text: scene.note ? `Your note: ${scene.note}` : "" });
    const toggle = row.createEl("button", { cls: "bunsho-pen", attr: { "data-focus-key": "scene:previous" } });
    setIcon(toggle.createSpan({ cls: "bunsho-pen-icon", attr: { "aria-hidden": "true" } }), "corner-up-left");
    toggle.createSpan({ text: scene.showingPrevious ? "Newer card" : "Previous card" });
    toggle.onclick = props.onTogglePrevious;
  }
  const titleRow = head.createDiv({ cls: "bunsho-scene-title-row" });
  titleRow.createEl("h3", { cls: "bunsho-scene-title", text: titleOf(scene) });
  if (!props.locked) {
    const fold = titleRow.createEl("button", { cls: "bunsho-pen", text: "Fold", attr: { "data-focus-key": "scene:fold" } });
    fold.onclick = props.onFold;
  }
  head.createEl("p", { cls: "bunsho-scene-description", text: descriptionOf(scene) });
  rankedRecord(scene.record).forEach((line) => {
    const sentence = recordChapterSentence(line, props.chapters);
    SceneRecordLine(top, { rank: line.rank, chapterOrdinal: line.pageId ? props.chapters[line.pageId]?.ordinal : undefined, text: `${line.message}${sentence ? ` ${sentence}` : ""}` });
  });
  drawRows(top, props, editable);
  if (mode === "readOnly") {
    const foot = card.createDiv({ cls: "bunsho-scene-foot is-kept" });
    const kept = foot.createDiv({ cls: "bunsho-director-line" });
    kept.appendText("Kept in ");
    kept.createSpan({ cls: "bunsho-director-strong", text: props.anchor.chapterTitle });
    return;
  }
  drawFoot(card, props, beats.length);
}

function drawRows(parent: HTMLElement, props: SceneCardProps, editable: boolean): void {
  const { scene, mode, beats } = props;
  const flagged = flaggedBeats(scene.record);
  const list = parent.createDiv({ cls: "bunsho-scene-beats" });
  let dragFrom: number | null = null;
  let dropAt: number | null = null;
  const marker = createDiv({ cls: "bunsho-beat-drop" });
  const clearDrag = (): void => { dragFrom = null; dropAt = null; marker.remove(); list.removeClass("is-dragging"); props.onDragging(false); };
  const drop = (event: DragEvent): void => {
    event.preventDefault();
    const [from, at] = [dragFrom, dropAt];
    clearDrag();
    if (from === null || at === null) return;
    const to = at > from ? at - 1 : at;
    if (to !== from) props.onReorder(from, to);
  };
  list.ondragover = (event) => { if (dragFrom !== null) event.preventDefault(); };
  list.ondrop = drop;
  const removedAt = props.removed?.index ?? -1;
  const undoRow = (): void => { if (props.removed) SceneRemovedRow(list, props.removed.line, props.onUndoRemove); };
  beats.forEach((beat, index) => {
    if (removedAt === index) undoRow();
    const editingThis = props.editing?.beatId === beat.beatId;
    const state: BeatRowState = mode === "writing" ? (props.writingBeat === beat.order ? "writing" : "rest") : props.regeneratingBeatId === beat.beatId ? "writing" : editingThis ? "editing" : "rest";
    SceneBeatRow(list, {
      n: index + 1, line: beat.intent, change: changeLine(beat), state, flagged: flagged.has(beat.order), regeneratePrice: props.prices.plan, focusKey: `beat:${beat.beatId}`,
      draftValue: editingThis ? props.editing?.value : undefined,
      onDraftChange: props.onEditChange, onComposing: props.onComposing, onCommit: props.onEditCommit, onCancel: props.onEditCancel,
      onEdit: editable && !props.editing ? () => props.onStartEdit(beat) : undefined,
      onRegenerate: editable && props.beatSlot?.beatId !== beat.beatId ? () => props.onOpenBeatSlot(beat) : undefined,
      onRemove: editable && beats.length > 1 ? () => props.onRemove(beat, index) : undefined,
      grip: editable && beats.length > 1 ? {
        onDragStart: () => { dragFrom = index; list.addClass("is-dragging"); props.onDragging(true); },
        onDragEnd: clearDrag,
        onMove: (by) => { const to = index + by; if (to >= 0 && to < beats.length) props.onReorder(index, to); },
      } : undefined,
      onDragOver: (event, row) => {
        if (dragFrom === null) return;
        event.preventDefault();
        const box = row.getBoundingClientRect();
        const before = event.clientY < box.top + box.height / 2;
        dropAt = before ? index : index + 1;
        if (before) row.before(marker); else row.after(marker);
      },
      onDrop: drop,
      onHover: props.onHoverBeat,
    });
    if (props.beatSlot?.beatId === beat.beatId && props.regeneratingBeatId !== beat.beatId) props.beatSlot.draw(list.createDiv({ cls: "bunsho-beat-slot" }));
  });
  if (removedAt >= beats.length) undoRow();
  if (props.editing && props.editing.beatId === undefined) {
    SceneBeatRow(list, { n: beats.length + 1, line: "", state: "editing", draftValue: props.editing.value, focusKey: "beat:new", onDraftChange: props.onEditChange, onComposing: props.onComposing, onCommit: props.onEditCommit, onCancel: props.onEditCancel });
  } else if (editable && !props.editing && beats.length < MAX_SCENE_BEATS) {
    const add = list.createDiv({ cls: "bunsho-beat-add" }).createEl("button", { cls: "bunsho-pen is-accent", text: ADD_BEAT, attr: { "data-focus-key": "beat:add" } });
    add.onclick = props.onStartAdd;
  }
}

function drawFoot(card: HTMLElement, props: SceneCardProps, beatCount: number): void {
  const { notice, mode } = props;
  const writing = mode === "writing";
  const writePrice = props.prices.perBeat !== null ? props.prices.perBeat * beatCount : null;
  const planLabel = price(props.prices.plan);
  const writeLabel = price(writePrice);
  const long = beatCount >= 7;
  const tooLong = beatCount > MAX_SCENE_BEATS;
  const foot = card.createDiv({ cls: `bunsho-scene-foot${long ? " is-long" : ""}`, attr: { "data-scene-foot": "" } });
  if (writing || mode === "regenerating") {
    const label = writing ? writeLabel : planLabel;
    foot.createDiv({ cls: "bunsho-fact is-reading", text: `${writing ? "writing the scene" : "regenerating the scene"}${label ? ` · ${label}` : ""}` });
    if (mode === "regenerating" && props.scene.note) foot.createDiv({ cls: "bunsho-small", text: `Your note: ${props.scene.note}` });
    return;
  }
  if (notice?.kind === "outOfCredits") { SceneOutOfCredits(foot, { ...notice, onOpenBilling: props.onOpenBilling }); return; }
  if (notice?.kind === "discarded") foot.createDiv({ cls: "bunsho-small", text: "Draft discarded. Nothing reached the page." });
  if (notice?.kind === "failed") SceneFailureLine(foot, notice);
  if (tooLong) foot.createDiv({ cls: "bunsho-director-line", text: `A scene is written in at most ${MAX_SCENE_BEATS} beats. Remove ${beatCount - MAX_SCENE_BEATS} to write it.` });
  SceneAnchorLine(foot, { ...props.anchor, trailing: long ? `${beatCount} beats` : undefined });
  const actions = foot.createDiv({ cls: "bunsho-scene-actions" });
  const write = FillButton(actions, { label: "", focusKey: "scene:write", onClick: props.onWrite });
  write.addClass("bunsho-priced");
  write.createSpan({ text: "Write scene" });
  if (writeLabel) write.createSpan({ cls: "bunsho-fact is-on-fill", text: writeLabel });
  write.disabled = beatCount === 0 || tooLong || props.locked || writeLabel === null;
  if (props.sceneSlot) { props.sceneSlot(foot); return; }
  const regenerate = actions.createEl("button", { cls: "bunsho-pen", attr: { "data-focus-key": "scene:regenerate" } });
  regenerate.createSpan({ text: "Regenerate scene" });
  if (planLabel) regenerate.createSpan({ cls: "bunsho-fact", text: planLabel });
  regenerate.disabled = props.locked || planLabel === null;
  regenerate.onclick = props.onOpenRegenerate;
}
