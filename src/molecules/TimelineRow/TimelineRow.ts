import { Fact } from "@/atoms/Fact";
import { TextAction } from "@/atoms/TextAction";

/** One thing changing between two chapters (desktop WorldTab TimelineRow), with no pen. Each place opens its passage. */
export interface TimelinePlace { coordinate: string; onGo: () => void; focusKey: string }
export interface TimelineRowProps { name: string; label: string; oldValue: string; newValue: string; from: TimelinePlace; to: TimelinePlace; note: string | null }

export function TimelineRow(parent: HTMLElement, { name, label, oldValue, newValue, from, to, note }: TimelineRowProps): HTMLElement {
  const row = parent.createDiv({ cls: "bunsho-timeline" });
  const head = row.createDiv({ cls: "bunsho-timeline-head" });
  head.createSpan({ cls: "bunsho-timeline-name", text: name });
  head.createSpan({ cls: "bunsho-timeline-label", text: label });
  const values = row.createDiv({ cls: "bunsho-timeline-values" });
  values.createSpan({ cls: "bunsho-timeline-old", text: oldValue });
  values.createSpan({ cls: "bunsho-timeline-arrow", text: "→" });
  values.createSpan({ cls: "bunsho-timeline-new", text: newValue });
  const places = row.createDiv({ cls: "bunsho-timeline-places" });
  TextAction(places, { label: from.coordinate, quiet: true, focusKey: from.focusKey, onClick: from.onGo });
  places.createSpan({ cls: "bunsho-timeline-arrow", text: "→" });
  TextAction(places, { label: to.coordinate, quiet: true, focusKey: to.focusKey, onClick: to.onGo });
  if (note) Fact(row, note);
  return row;
}
