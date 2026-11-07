import { TextAction } from "@/atoms/TextAction";

/** The one alert card the panel may show (never a stack of banners). */
export interface AlertCardProps { title: string; body: string; action?: { label: string; onClick: () => void } }

export function AlertCard(parent: HTMLElement, { title, body, action }: AlertCardProps): HTMLElement {
  const card = parent.createDiv({ cls: "bunsho-alert" });
  card.createDiv({ cls: "bunsho-alert-title", text: title });
  card.createEl("p", { text: body });
  if (action) TextAction(card.createDiv(), action);
  return card;
}
