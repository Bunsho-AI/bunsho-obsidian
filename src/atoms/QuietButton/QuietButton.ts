/** A plain Obsidian button for secondary actions. */
export interface QuietButtonProps { label: string; onClick: () => void }

export function QuietButton(parent: HTMLElement, { label, onClick }: QuietButtonProps): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "bunsho-quiet", text: label });
  button.onclick = onClick;
  return button;
}
