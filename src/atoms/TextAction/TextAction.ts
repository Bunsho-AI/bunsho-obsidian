/** A text action with no button chrome (desktop: accent underline; quiet variant in muted text). */
export interface TextActionProps { label: string; onClick: () => void; quiet?: boolean }

export function TextAction(parent: HTMLElement, { label, onClick, quiet = false }: TextActionProps): HTMLButtonElement {
  const button = parent.createEl("button", { cls: `bunsho-text-action${quiet ? " is-quiet" : ""}`, text: label });
  button.onclick = onClick;
  return button;
}
