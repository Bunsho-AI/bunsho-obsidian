import { PenField } from "@/atoms/PenField";
import { TextAction } from "@/atoms/TextAction";

/** The edit state of a hand-typed fact (desktop CanonFactEdit). Remove lives here, never on the resting row. */
export interface CanonFactEditProps { label: string; value: string; focusKey: string; onValue: (value: string) => void; onComposing: (composing: boolean) => void; onSave: () => void; onCancel: () => void; onRemove: () => void }

export function CanonFactEdit(parent: HTMLElement, props: CanonFactEditProps): void {
  const box = parent.createDiv({ cls: "bunsho-composer bunsho-fact-edit" });
  box.createSpan({ cls: "bunsho-world-label", text: props.label });
  let { value } = props;
  const ready = (): boolean => value.trim().length > 0;
  let sync = (): void => undefined;
  PenField(box, { value, label: "Value", cls: "is-manuscript", focusKey: `${props.focusKey}:value`, onComposing: props.onComposing, onEscape: props.onCancel, onEnter: () => { if (ready()) props.onSave(); }, onInput: (text) => { value = text; props.onValue(text); sync(); } });
  const controls = box.createDiv({ cls: "bunsho-composer-controls" });
  const save = TextAction(controls, { label: "Save", plain: true, focusKey: `${props.focusKey}:save`, onClick: props.onSave });
  TextAction(controls, { label: "Cancel", quiet: true, focusKey: `${props.focusKey}:cancel`, onClick: props.onCancel });
  TextAction(controls, { label: "Remove", quiet: true, focusKey: `${props.focusKey}:remove`, onClick: props.onRemove }).addClass("is-danger");
  sync = () => { save.disabled = !ready(); };
}
