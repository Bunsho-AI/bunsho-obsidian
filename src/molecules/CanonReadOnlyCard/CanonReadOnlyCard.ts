import { QuietButton } from "@/atoms/QuietButton";

/** One card at the head of the list when a plan has ended. Every row below stands, with its pen at rest. */
export interface CanonReadOnlyCardProps { title: string; onRenew: () => void }

export function CanonReadOnlyCard(parent: HTMLElement, { title, onRenew }: CanonReadOnlyCardProps): void {
  const card = parent.createDiv({ cls: "bunsho-card bunsho-canon-readonly" });
  card.createSpan({ cls: "bunsho-caps", text: "Read only" });
  card.createDiv({ cls: "bunsho-canon-readonly-title", text: title });
  card.createDiv({ cls: "bunsho-claim", text: "Everything you declared is still here. Canon reads until you renew." });
  const actions = card.createDiv({ cls: "bunsho-alert-actions" });
  QuietButton(actions, { label: "Renew", onClick: onRenew });
}
