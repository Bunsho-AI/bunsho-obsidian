import { FillButton } from "@/atoms/FillButton";
import { price } from "@/helpers/director/sceneView";
import { formatNumber } from "@/utils/format";

export interface SceneOutOfCreditsProps { action: "Planning" | "Writing"; needed: number | null; balance: number | null; onOpenBilling: () => void }

export function SceneOutOfCredits(parent: HTMLElement, { action, needed, balance, onOpenBilling }: SceneOutOfCreditsProps): void {
  const card = parent.createDiv({ cls: "bunsho-director-credits", attr: { role: "status" } });
  card.createSpan({ cls: "bunsho-record-pill", text: "Out of credits" });
  const line = card.createDiv({ cls: "bunsho-director-credits-line" });
  const amount = price(needed);
  line.appendText(`${action} this scene needs `);
  if (amount) line.createSpan({ cls: "bunsho-fact", text: `${amount}${balance !== null ? ` of ${formatNumber(balance)}` : ""}` });
  else line.appendText("more");
  line.appendText(" credits");
  card.createDiv({ cls: "bunsho-director-line", text: "Nothing was charged. The card stays as it is." });
  FillButton(card.createDiv(), { label: "Open billing", small: true, focusKey: "scene:billing", onClick: onOpenBilling });
}
