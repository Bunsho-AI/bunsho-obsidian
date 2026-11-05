import { PenField } from "@/atoms/PenField";
import { TextAction } from "@/atoms/TextAction";

/** Rename, and Remove (desktop CanonEntityRename). The caveat shows only when something cites them. Removing drops the record, never the prose. */
export interface CanonEntityRenameProps {
  name: string;
  cited: number;
  removeLabel: string;
  busy: boolean;
  focusKey: string;
  onName: (name: string) => void;
  onComposing: (composing: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
  slot?: (parent: HTMLElement) => void;
}

export function CanonEntityRename(parent: HTMLElement, props: CanonEntityRenameProps): void {
  const box = parent.createDiv({ cls: "bunsho-composer bunsho-fact-edit" });
  let { name } = props;
  const ready = (): boolean => name.trim().length > 0 && !props.busy;
  let sync = (): void => undefined;
  PenField(box, { value: name, label: "Name", focusKey: `${props.focusKey}:name`, onComposing: props.onComposing, onEscape: props.onCancel, onEnter: () => { if (ready()) props.onSave(); }, onInput: (text) => { name = text; props.onName(text); sync(); } });
  props.slot?.(box);
  if (props.cited > 0) box.createDiv({ cls: "bunsho-note-small", text: `Cited on ${props.cited} ${props.cited === 1 ? "page" : "pages"}. Removing them drops the record, not the prose.` });
  const controls = box.createDiv({ cls: "bunsho-composer-controls" });
  const save = TextAction(controls, { label: "Save", plain: true, focusKey: `${props.focusKey}:save`, onClick: props.onSave });
  TextAction(controls, { label: "Cancel", quiet: true, focusKey: `${props.focusKey}:cancel`, onClick: props.onCancel });
  TextAction(controls, { label: props.removeLabel, quiet: true, focusKey: `${props.focusKey}:remove`, onClick: props.onRemove }).addClass("is-danger");
  sync = () => { save.disabled = !ready(); };
  sync();
}
