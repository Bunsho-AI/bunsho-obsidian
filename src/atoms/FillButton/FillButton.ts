/** The filled amber button: the priced call to action (gold is a fill, as on desktop). */
export interface FillButtonProps { label: string; onClick: () => void }

export function FillButton(parent: HTMLElement, { label, onClick }: FillButtonProps): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "bunsho-fill", text: label });
  button.onclick = onClick;
  return button;
}
