import { Fact } from "@/atoms/Fact";
import { TextAction } from "@/atoms/TextAction";

/** `Add character`, and how many there are. */
export interface CanonAddControlProps { label: string; count: string | null; focusKey: string; onOpen: () => void }

export function CanonAddControl(parent: HTMLElement, props: CanonAddControlProps): void {
  const row = parent.createDiv({ cls: "bunsho-canon-add" });
  TextAction(row, { label: props.label, plain: true, focusKey: props.focusKey, onClick: props.onOpen });
  if (props.count) Fact(row, props.count);
}
