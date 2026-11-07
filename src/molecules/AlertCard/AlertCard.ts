import { TextAction } from "@/atoms/TextAction";

/**
 * The one alert card the panel may show (never a stack of banners). `label` is the desktop's filled rank-1 label; a card with one
 * can go on to a title of its own, or none.
 */
export interface AlertCardProps { label?: string; title?: string; body: string; action?: { label: string; onClick: () => void } }

export function AlertCard(parent: HTMLElement, { label, title, body, action }: AlertCardProps): HTMLElement {
  const card = parent.createDiv({ cls: "bunsho-alert" });
  if (label) card.createSpan({ cls: "bunsho-alert-label", text: label });
  if (title) card.createDiv({ cls: "bunsho-alert-title", text: title });
  card.createEl("p", { text: body });
  if (action) TextAction(card.createDiv(), action);
  return card;
}
