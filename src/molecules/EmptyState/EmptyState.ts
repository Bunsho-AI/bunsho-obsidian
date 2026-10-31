/** A short titled state (nothing checked yet, no contradictions, …); returns the box for any extra content. */
export interface EmptyStateProps { title: string; body?: string }

export function EmptyState(parent: HTMLElement, { title, body }: EmptyStateProps): HTMLElement {
  const box = parent.createDiv({ cls: "bunsho-empty" });
  box.createDiv({ cls: "bunsho-empty-title", text: title });
  if (body) box.createEl("p", { cls: "bunsho-empty-body", text: body });
  return box;
}
