import { Fact } from "@/atoms/Fact";
import { TextAction } from "@/atoms/TextAction";

/** One line of machine fact and at most one text action (desktop Continuity status row). */
export interface StatusRowProps { fact: string; reading?: boolean; action?: { label: string; onClick: () => void } }

export function StatusRow(parent: HTMLElement, { fact, reading = false, action }: StatusRowProps): HTMLElement {
  const row = parent.createDiv({ cls: "bunsho-status" });
  const text = Fact(row, fact, "bunsho-status-text");
  if (reading) text.addClass("is-reading");
  if (action) TextAction(row.createSpan({ cls: "bunsho-status-action" }), action);
  return row;
}
