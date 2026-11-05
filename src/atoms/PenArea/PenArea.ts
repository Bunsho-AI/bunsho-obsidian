/** A multi-line field: typing goes to the owner without a redraw, so the cursor and any IME composition are left alone. Keys are the owner's, and wait for a composition to end. */
export interface PenAreaProps {
  value: string;
  label: string;
  focusKey: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  cls?: string;
  onInput: (value: string, field: HTMLTextAreaElement) => void;
  onComposing?: (composing: boolean) => void;
  onKey?: (event: KeyboardEvent, field: HTMLTextAreaElement) => void;
}

export function PenArea(parent: HTMLElement, props: PenAreaProps): HTMLTextAreaElement {
  const field = parent.createEl("textarea", { cls: `bunsho-pen-field bunsho-pen-area${props.cls ? ` ${props.cls}` : ""}`, attr: { "aria-label": props.label, "data-focus-key": props.focusKey, rows: String(props.rows ?? 2), ...(props.maxLength ? { maxlength: String(props.maxLength) } : {}) }, placeholder: props.placeholder ?? "" });
  field.value = props.value;
  field.oninput = (event) => { if (!(event as InputEvent).isComposing) props.onInput(field.value, field); };
  field.addEventListener("compositionstart", () => props.onComposing?.(true));
  field.addEventListener("compositionend", () => { props.onInput(field.value, field); props.onComposing?.(false); });
  field.onkeydown = (event) => { if (!event.isComposing) props.onKey?.(event, field); };
  return field;
}
