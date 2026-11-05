/** One quiet line: where Keep will place the text. "the end" or "the cursor" is the control, and opens two rows under it. The chapter follows the one open in the editor. */
export type Placement = "append" | "cursor";
export interface SceneAnchorLineProps {
  placement: Placement;
  chapterTitle: string;
  /** Absent: the placement is fixed, a written or kept scene. */
  onPlacementChange?: (placement: Placement) => void;
  open?: boolean;
  onToggle?: () => void;
  /** "9 beats" or "1,512 words". */
  trailing?: string;
  focusKey?: string;
}

const OPTIONS: { value: Placement; label: string }[] = [{ value: "append", label: "At the end of the chapter" }, { value: "cursor", label: "At the cursor" }];

export function SceneAnchorLine(parent: HTMLElement, { placement, chapterTitle, onPlacementChange, open, onToggle, trailing, focusKey }: SceneAnchorLineProps): void {
  const root = parent.createDiv({ cls: "bunsho-anchor" });
  const line = root.createDiv({ cls: "bunsho-anchor-line" });
  const text = line.createSpan({ cls: "bunsho-anchor-text" });
  text.appendText("Goes at ");
  const where = placement === "cursor" ? "the cursor" : "the end";
  if (onPlacementChange) {
    const control = text.createEl("button", { cls: "bunsho-anchor-control", text: where, attr: { "aria-haspopup": "listbox", "aria-expanded": String(Boolean(open)), ...(focusKey ? { "data-focus-key": focusKey } : {}) } });
    control.onclick = () => onToggle?.();
  } else text.createSpan({ cls: "bunsho-anchor-strong", text: where });
  text.appendText(placement === "cursor" ? " in " : " of ");
  text.createSpan({ cls: "bunsho-anchor-strong", text: chapterTitle });
  if (trailing) line.createSpan({ cls: "bunsho-fact bunsho-anchor-trailing", text: trailing });
  if (!open || !onPlacementChange) return;
  const list = root.createDiv({ cls: "bunsho-anchor-options", attr: { role: "listbox" } });
  for (const option of OPTIONS) {
    const row = list.createEl("button", { cls: `bunsho-anchor-option${option.value === placement ? " is-active" : ""}`, text: option.label, attr: { role: "option", "aria-selected": String(option.value === placement) } });
    row.onclick = () => onPlacementChange(option.value);
  }
}
