/** The filled amber button: the priced call to action (gold is a fill, as on desktop). */
export interface FillButtonProps { label: string; onClick: () => void; small?: boolean; focusKey?: string }

export function FillButton(parent: HTMLElement, { label, onClick, small = false, focusKey }: FillButtonProps): HTMLButtonElement {
  const button = parent.createEl("button", { cls: `bunsho-fill${small ? " is-small" : ""}`, text: label, attr: focusKey ? { "data-focus-key": focusKey } : {} });
  button.onclick = onClick;
  return button;
}
