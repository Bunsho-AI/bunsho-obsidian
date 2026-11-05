import { PenField } from "@/atoms/PenField";
import { TextAction } from "@/atoms/TextAction";
import { DIMENSION_GROUPS, dimensionEntry, dimensionLabel, needsDetail } from "@/helpers/canon/dimensions";

/**
 * "Add a fact" (desktop CanonFactComposer): one column at any width, a native select over the whole vocabulary (there is no free-text
 * dimension), and the row this makes, live. Typing never redraws the panel: this draws its own preview and its own Add.
 */
export interface FactDetailOption { value: string; label: string }

export interface CanonFactComposerProps {
  dimension: string;
  detail: string | null;
  detailLabel: string | null;
  detailOptions: readonly FactDetailOption[];
  value: string;
  mark: string;
  busy: boolean;
  focusKey: string;
  onDimension: (dimension: string) => void;
  onDetail: (detail: string, label: string) => void;
  onTopic: (topic: string) => void;
  onValue: (value: string) => void;
  onComposing: (composing: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Rendered between the fields and the preview: the inline composer for someone not in the record yet. */
  slot?: (parent: HTMLElement) => void;
}

export function CanonFactComposer(parent: HTMLElement, props: CanonFactComposerProps): void {
  const box = parent.createDiv({ cls: "bunsho-composer" });
  const entry = dimensionEntry(props.dimension);
  const wantsDetail = needsDetail(props.dimension);
  const isTopic = entry?.detail === "topic";
  let { value, detail } = props;

  const select = box.createEl("select", { cls: "dropdown bunsho-composer-select", attr: { "aria-label": "Dimension", "data-focus-key": `${props.focusKey}:dimension` } });
  for (const group of DIMENSION_GROUPS) {
    const options = select.createEl("optgroup", { attr: { label: group.label } });
    for (const item of group.items) options.createEl("option", { text: item.label, value: item.key });
  }
  select.value = props.dimension;
  select.onchange = () => props.onDimension(select.value);

  if (wantsDetail && !isTopic) {
    const picker = box.createEl("select", { cls: "dropdown bunsho-composer-select", attr: { "aria-label": "Detail", "data-focus-key": `${props.focusKey}:detail` } });
    picker.createEl("option", { text: "Choose", value: "" });
    for (const option of props.detailOptions) picker.createEl("option", { text: option.label, value: option.value });
    picker.value = detail ?? "";
    picker.onchange = () => props.onDetail(picker.value, props.detailOptions.find((o) => o.value === picker.value)?.label ?? "");
  }
  const ready = (): boolean => value.trim().length > 0 && (!wantsDetail || Boolean(detail?.trim())) && !props.busy;
  let sync = (): void => undefined;
  const submit = (): void => { if (ready()) props.onSubmit(); };
  if (wantsDetail && isTopic) {
    PenField(box, { value: detail ?? "", label: "Detail", focusKey: `${props.focusKey}:topic`, onComposing: props.onComposing, onEscape: props.onCancel, onEnter: submit,
      onInput: (topic) => { detail = topic; props.onTopic(topic); sync(); } });
  }
  PenField(box, { value, label: "Value", cls: "is-manuscript", focusKey: `${props.focusKey}:value`, onComposing: props.onComposing, onEscape: props.onCancel, onEnter: submit,
    onInput: (text) => { value = text; props.onValue(text); sync(); } });
  props.slot?.(box);

  const preview = box.createDiv({ cls: "bunsho-composer-preview" });
  preview.createDiv({ cls: "bunsho-fact", text: "the row this makes" });
  const line = preview.createDiv({ cls: "bunsho-world-fact" });
  const label = line.createSpan({ cls: "bunsho-world-label" });
  const shown = line.createSpan({ cls: "bunsho-world-value is-canon" });
  preview.createDiv({ cls: "bunsho-fact bunsho-canon-mark", text: props.mark });

  const controls = box.createDiv({ cls: "bunsho-composer-controls" });
  const add = TextAction(controls, { label: "Add fact", plain: true, focusKey: `${props.focusKey}:add`, onClick: submit });
  TextAction(controls, { label: "Cancel", quiet: true, focusKey: `${props.focusKey}:cancel`, onClick: props.onCancel });
  sync = () => {
    label.setText(dimensionLabel(props.dimension, { detailLabel: (isTopic ? detail : props.detailLabel) ?? undefined }));
    shown.setText(value);
    add.disabled = !ready();
  };
  sync();
}
