/**
 * A field in one of the pen's inline states. Typing goes to the owner without a redraw, so the cursor and any IME composition are
 * left alone; Enter and Escape are this field's alone, and Enter waits for a composition to finish.
 */
export interface PenFieldProps {
  value: string;
  label: string;
  focusKey: string;
  placeholder?: string;
  cls?: string;
  maxLength?: number;
  onInput: (value: string) => void;
  onComposing?: (composing: boolean) => void;
  onEnter?: () => void;
  onEscape?: () => void;
}

export function PenField(parent: HTMLElement, props: PenFieldProps): HTMLInputElement {
  const input = parent.createEl("input", { cls: `bunsho-pen-field${props.cls ? ` ${props.cls}` : ""}`, type: "text", value: props.value, placeholder: props.placeholder ?? "", attr: { "aria-label": props.label, "data-focus-key": props.focusKey, ...(props.maxLength ? { maxlength: String(props.maxLength) } : {}) } });
  input.oninput = (event) => { if (!(event as InputEvent).isComposing) props.onInput(input.value); };
  input.addEventListener("compositionstart", () => props.onComposing?.(true));
  input.addEventListener("compositionend", () => { props.onInput(input.value); props.onComposing?.(false); });
  input.onkeydown = (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); props.onEnter?.(); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onEscape?.(); }
  };
  return input;
}
