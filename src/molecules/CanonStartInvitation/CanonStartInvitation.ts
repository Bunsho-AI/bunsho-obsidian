/** An empty record (desktop CanonStartInvitation and CanonEmptyState). The caller's slot holds the one control, when the pen is open. */
export interface CanonStartInvitationProps { penOpen: boolean }

export function CanonStartInvitation(parent: HTMLElement, { penOpen }: CanonStartInvitationProps): HTMLElement {
  const box = parent.createDiv({ cls: "bunsho-canon-start" });
  box.createEl("h3", { cls: "bunsho-canon-start-title", text: penOpen ? "Your story record" : "Nothing recorded yet" });
  box.createEl("p", { cls: "bunsho-canon-start-body", text: penOpen ? "Add the people, places and facts that are true. Bunsho holds your prose against them when you ask."
    : "Bunsho fills this in as it reads. What it finds arrives with the line it came from, and anything you declare yourself outranks it." });
  return box;
}
