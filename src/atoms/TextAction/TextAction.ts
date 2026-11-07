/** A text action with no button chrome (desktop: accent underline; quiet variant in muted text). */
export interface TextActionProps { label: string; onClick: () => void; quiet?: boolean; /** Accent text with no underline at rest, as the desktop card's Resolve. */ plain?: boolean; focusKey?: string }

export function TextAction(parent: HTMLElement, { label, onClick, quiet = false, plain = false, focusKey }: TextActionProps): HTMLButtonElement {
  const button = parent.createEl("button", { cls: `bunsho-text-action${quiet ? " is-quiet" : ""}${plain ? " is-plain" : ""}`, text: label, attr: focusKey ? { "data-focus-key": focusKey } : {} });
  button.onclick = onClick;
  return button;
}
