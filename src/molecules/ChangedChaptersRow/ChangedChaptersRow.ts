import { FillButton } from "@/atoms/FillButton";

/** The chapters changed since their last check, and the priced way to review them. The price on the button is the consent. */
export interface ChangedChaptersRowProps { message: string; label: string; onReview: () => void; focusKey?: string }

export function ChangedChaptersRow(parent: HTMLElement, { message, label, onReview, focusKey = "changed:review" }: ChangedChaptersRowProps): void {
  const row = parent.createDiv({ cls: "bunsho-changed" });
  row.createEl("p", { cls: "bunsho-changed-text", text: message });
  FillButton(row, { label, small: true, focusKey, onClick: onReview });
}
