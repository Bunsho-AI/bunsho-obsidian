import { Fact } from "@/atoms/Fact";
import { PenField } from "@/atoms/PenField";
import { TextAction } from "@/atoms/TextAction";

/** "Add character" (desktop CanonEntityComposer). Type is not a field: the active filter chose it. */
export interface CanonEntityComposerProps {
  heading: string;
  addLabel: string;
  name: string;
  aliases: string;
  /** An identity question is waiting: Add rests until it is answered. */
  asking: boolean;
  busy: boolean;
  focusKey: string;
  onName: (name: string) => void;
  onAliases: (aliases: string) => void;
  onComposing: (composing: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** The identity question, beneath the fields. */
  slot?: (parent: HTMLElement) => void;
}

export function CanonEntityComposer(parent: HTMLElement, props: CanonEntityComposerProps): void {
  const box = parent.createDiv({ cls: "bunsho-card bunsho-composer bunsho-entity-composer" });
  const head = box.createDiv({ cls: "bunsho-composer-head" });
  head.createSpan({ cls: "bunsho-caps", text: props.heading });
  Fact(head, "no scenes yet");
  let { name } = props;
  const ready = (): boolean => name.trim().length > 0 && !props.asking && !props.busy;
  const submit = (): void => { if (ready()) props.onSubmit(); };
  let sync = (): void => undefined;
  box.createDiv({ cls: "bunsho-caps bunsho-field-label", text: "Name" });
  PenField(box, { value: name, label: "Name", focusKey: `${props.focusKey}:name`, onComposing: props.onComposing, onEscape: props.onCancel, onEnter: submit, onInput: (text) => { name = text; props.onName(text); sync(); } });
  box.createDiv({ cls: "bunsho-caps bunsho-field-label", text: "Also known as" });
  PenField(box, { value: props.aliases, label: "Also known as", placeholder: "Separate names with commas", focusKey: `${props.focusKey}:aliases`, onComposing: props.onComposing, onEscape: props.onCancel, onEnter: submit, onInput: props.onAliases });
  props.slot?.(box);
  const controls = box.createDiv({ cls: "bunsho-composer-controls" });
  const add = TextAction(controls, { label: props.addLabel, plain: true, focusKey: `${props.focusKey}:add`, onClick: submit });
  TextAction(controls, { label: "Cancel", quiet: true, focusKey: `${props.focusKey}:cancel`, onClick: props.onCancel });
  Fact(controls, "↵ to add", "bunsho-composer-hint");
  sync = () => { add.disabled = !ready(); };
  sync();
}
