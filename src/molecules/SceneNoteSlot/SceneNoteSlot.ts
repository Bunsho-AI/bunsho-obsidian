import { PenField } from "@/atoms/PenField";
import { NOTE_SLOT_COPY, price, type NoteSlotKind } from "@/helpers/director/sceneView";

/** An optional note, the price, go. */
export interface SceneNoteSlotProps {
  kind: NoteSlotKind;
  price: number | null;
  note: string;
  focusKey: string;
  onNote: (note: string) => void;
  onComposing: (composing: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function SceneNoteSlot(parent: HTMLElement, props: SceneNoteSlotProps): void {
  const copy = NOTE_SLOT_COPY[props.kind];
  const slot = parent.createDiv({ cls: "bunsho-note-slot" });
  slot.createSpan({ cls: "bunsho-note-slot-title", text: copy.title });
  const label = price(props.price);
  PenField(slot, { value: props.note, label: copy.title, focusKey: props.focusKey, placeholder: "A note, if you want one", maxLength: 1000, onInput: props.onNote, onComposing: props.onComposing,
    onEnter: () => { if (label) props.onSubmit(); }, onEscape: props.onCancel });
  if (copy.hint) slot.createSpan({ cls: "bunsho-small", text: copy.hint });
  const actions = slot.createDiv({ cls: "bunsho-note-slot-actions" });
  const go = actions.createEl("button", { cls: "bunsho-outlined", attr: { "data-focus-key": `${props.focusKey}:go` } });
  go.disabled = !label;
  go.createSpan({ text: copy.action });
  if (label) go.createSpan({ cls: "bunsho-fact", text: label });
  go.onclick = props.onSubmit;
  const cancel = actions.createEl("button", { cls: "bunsho-pen", text: "Cancel" });
  cancel.onclick = props.onCancel;
}
