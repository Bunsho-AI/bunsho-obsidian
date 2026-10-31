import { Fact } from "@/atoms/Fact";

/** A severity section header with its count; the rank-1 header is in danger red. */
export function GroupHeader(parent: HTMLElement, label: string, count: number, rank1: boolean): HTMLElement {
  const head = parent.createDiv({ cls: `bunsho-group${rank1 ? " is-rank1" : ""}` });
  head.createSpan({ cls: "bunsho-group-label", text: label });
  Fact(head, String(count));
  return head;
}
