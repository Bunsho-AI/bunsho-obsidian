import { setIcon } from "obsidian";
import { PenArea } from "@/atoms/PenArea";
import { price } from "@/helpers/director/sceneView";

/**
 * A beat is a row inside the scene, never a card. Story language only: no pacing, no status words, no ids. Editing, reordering, removing and adding are free. The desktop shows the grip and
 * the actions on hover; a narrow panel and a keyboard need them to be there, so they are.
 */
export type BeatRowState = "rest" | "editing" | "writing" | "lit" | "compact";
export interface SceneBeatRowProps {
  n: number;
  line: string;
  change?: string;
  state: BeatRowState;
  flagged?: boolean;
  regeneratePrice?: number | null;
  draftValue?: string;
  focusKey: string;
  onDraftChange?: (value: string) => void;
  onComposing?: (composing: boolean) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  onEdit?: () => void;
  onRegenerate?: () => void;
  onRemove?: () => void;
  /** The row can be dragged, or moved with the arrow keys on its grip. */
  grip?: { onDragStart: (event: DragEvent) => void; onDragEnd: () => void; onMove: (by: -1 | 1) => void };
  onDragOver?: (event: DragEvent, row: HTMLElement) => void;
  onDrop?: (event: DragEvent) => void;
  onHover?: (order: number | null) => void;
}

export function SceneRemovedRow(parent: HTMLElement, line: string, onUndo: () => void): void {
  const row = parent.createDiv({ cls: "bunsho-beat-removed" });
  row.createSpan({ cls: "bunsho-beat-removed-line", text: `Removed: ${line}` });
  const undo = row.createEl("button", { cls: "bunsho-pen is-accent", text: "Undo", attr: { "data-focus-key": "beat:undo" } });
  undo.onclick = onUndo;
}

export function SceneBeatRow(parent: HTMLElement, props: SceneBeatRowProps): HTMLElement {
  const { n, line, change, state, flagged, focusKey } = props;
  const row = parent.createDiv({ cls: `bunsho-beat is-${state}`, attr: { "data-beat-row": String(n) } });
  if (props.onHover) { row.onmouseenter = () => props.onHover?.(n); row.onmouseleave = () => props.onHover?.(null); }
  if (props.onDragOver) row.ondragover = (event) => props.onDragOver?.(event, row);
  if (props.onDrop) row.ondrop = (event) => props.onDrop?.(event);
  const side = row.createDiv({ cls: "bunsho-beat-side" });
  side.createSpan({ cls: `bunsho-fact bunsho-beat-n${flagged ? " is-flagged" : ""}`, text: String(n) });
  if (props.grip) {
    const { grip } = props;
    const handle = side.createEl("button", { cls: "bunsho-beat-grip", attr: { draggable: "true", "aria-label": `Move beat ${n}: drag, or press the up and down arrow keys`, title: "Drag to reorder", "data-focus-key": `${focusKey}:grip` } });
    setIcon(handle, "grip-vertical");
    handle.ondragstart = (event) => {
      if (event.dataTransfer) { event.dataTransfer.setDragImage(row, 12, 12); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(n)); }
      grip.onDragStart(event);
    };
    handle.ondragend = grip.onDragEnd;
    handle.onkeydown = (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      grip.onMove(event.key === "ArrowUp" ? -1 : 1);
    };
  }
  const body = row.createDiv({ cls: "bunsho-beat-body" });
  if (state === "editing") {
    PenArea(body, { value: props.draftValue ?? line, label: "What happens", focusKey: `${focusKey}:field`, placeholder: "What happens", maxLength: 2000, cls: "bunsho-beat-field", onInput: (value) => props.onDraftChange?.(value), onComposing: props.onComposing,
      onKey: (event) => {
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); props.onCommit?.(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onCancel?.(); }
      } });
    body.createDiv({ cls: "bunsho-small", text: "Enter keeps it · Esc puts it back" });
    return row;
  }
  const text = body.createDiv({ cls: `bunsho-beat-line${props.onEdit ? " is-editable" : ""}`, text: line });
  if (props.onEdit) {
    const edit = props.onEdit;
    text.setAttrs({ role: "button", tabindex: "0", "data-focus-key": `${focusKey}:line`, "aria-label": `Edit beat ${n}` });
    text.onclick = edit;
    text.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); edit(); } };
  }
  if (change && state !== "compact") body.createDiv({ cls: "bunsho-beat-change", text: change });
  if (props.onRegenerate || props.onRemove) {
    const actions = body.createDiv({ cls: "bunsho-beat-actions" });
    if (props.onRegenerate) {
      const label = price(props.regeneratePrice);
      const regenerate = actions.createEl("button", { cls: "bunsho-pen", attr: { "data-focus-key": `${focusKey}:regenerate` } });
      regenerate.createSpan({ text: "Regenerate this beat" });
      if (label) regenerate.createSpan({ cls: "bunsho-fact", text: label });
      regenerate.disabled = !label;
      regenerate.onclick = props.onRegenerate;
    }
    if (props.onRemove) {
      const remove = actions.createEl("button", { cls: "bunsho-pen is-quiet", text: "Remove", attr: { "data-focus-key": `${focusKey}:remove` } });
      remove.onclick = props.onRemove;
    }
  }
  return row;
}
