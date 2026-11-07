import { Fact } from "@/atoms/Fact";
import { TextAction } from "@/atoms/TextAction";

/**
 * The fact row (desktop CanonFactRow). Origin is carried by the typeface, never a badge: what a check found is in the interface's
 * face, with its passage as warrant; what the writer declared is in the manuscript's, with their mark. One verb to a row, always
 * visible, and on its own line when the panel is narrow: declare in gold, amend in grey.
 */
export interface CanonFactRowProps {
  id: string;
  origin: "found" | "canon";
  label: string;
  value: string;
  earlier: boolean;
  mark: string | null;
  quote: string | null;
  /** Why this may no longer match the story. */
  note: string | null;
  verb: string | null;
  onGo?: () => void;
  onVerb?: () => void;
}

export function CanonFactRow(parent: HTMLElement, props: CanonFactRowProps): void {
  const row = parent.createDiv({ cls: `bunsho-world-row bunsho-canon-row${props.earlier ? " is-earlier" : ""}`, attr: { "data-origin": props.origin } });
  const text = row.createDiv({ cls: "bunsho-canon-text" });
  const line = text.createDiv({ cls: "bunsho-world-fact" });
  line.createSpan({ cls: "bunsho-world-label", text: props.label });
  line.createSpan({ cls: props.origin === "canon" ? "bunsho-world-value is-canon" : "bunsho-world-value", text: props.value });
  if (props.mark) Fact(text, props.mark, "bunsho-canon-mark");
  if (props.quote && props.onGo) {
    const { onGo } = props;
    const quote = text.createDiv({ cls: "bunsho-passage bunsho-quote", text: props.quote, attr: { role: "button", tabindex: "0", "aria-label": `Go to the passage: ${props.quote}` } });
    quote.onclick = onGo;
    quote.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onGo(); } };
  }
  if (props.note) Fact(text, props.note);
  if (props.verb && props.onVerb) {
    TextAction(row.createDiv({ cls: "bunsho-canon-pen" }), { label: props.verb, quiet: props.verb !== "Make canon", plain: props.verb === "Make canon", focusKey: `pen:${props.verb}:${props.id}`, onClick: props.onVerb });
  }
}
