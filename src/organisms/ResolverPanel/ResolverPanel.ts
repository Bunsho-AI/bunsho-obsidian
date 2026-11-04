import { Fact } from "@/atoms/Fact";
import { TextAction } from "@/atoms/TextAction";

/**
 * The desktop Resolver's evidence rail and decision bar, in the side panel. The writer's own editor is the manuscript
 * column: "Open" selects the passage there, so a fix is made in the note itself.
 */
export interface ResolverPassage { quote: string; coordinate: string; onOpen: () => void }

export interface ResolverPanelProps {
  claim: string;
  passages: ResolverPassage[];
  note: string | null;
  subject: string | null;
  summary: string | null;
  onClose: () => void;
  onDeliberate: () => void;
  onDismiss: () => void;
  onNext: (() => void) | null;
}

function block(parent: HTMLElement, label: string, loud: boolean, passage: ResolverPassage): void {
  const card = parent.createDiv({ cls: `bunsho-card${loud ? " is-rank1" : ""}` });
  card.createSpan({ cls: loud ? "bunsho-severity" : "bunsho-caps", text: label });
  card.createDiv({ cls: "bunsho-rail-quote", text: `“${passage.quote}”` });
  const foot = card.createDiv({ cls: "bunsho-card-foot" });
  Fact(foot, passage.coordinate, "bunsho-coords");
  TextAction(foot, { label: "Open", plain: true, onClick: passage.onOpen });
}

function button(parent: HTMLElement, label: string, cls: string, onClick: () => void): void {
  parent.createEl("button", { cls: `bunsho-decision ${cls}`, text: label }).onclick = onClick;
}

export function ResolverPanel(parent: HTMLElement, props: ResolverPanelProps): void {
  const root = parent.createDiv({ cls: "bunsho-resolver" });
  const head = root.createDiv({ cls: "bunsho-resolver-head" });
  head.createDiv({ cls: "bunsho-resolver-title", text: props.claim });
  const close = head.createEl("button", { cls: "bunsho-resolver-close", text: "×", attr: { "aria-label": "Close", "data-focus-key": "resolver:close" } });
  close.onclick = props.onClose;

  const rail = root.createDiv({ cls: "bunsho-list" });
  props.passages.forEach((passage, index) => block(rail, index === 0 ? "This page" : "Contradicts", index === 0, passage));
  if (props.note) {
    const note = rail.createDiv({ cls: "bunsho-card bunsho-rail-plain" });
    note.createSpan({ cls: "bunsho-caps", text: "Note" });
    note.createDiv({ cls: "bunsho-rail-note", text: props.note });
  }
  if (props.subject || props.summary) {
    const context = rail.createDiv({ cls: "bunsho-rail-context" });
    context.createSpan({ cls: "bunsho-caps", text: "Context" });
    if (props.subject) context.createSpan({ cls: "bunsho-context-pill", text: props.subject });
    if (props.summary) context.createDiv({ cls: "bunsho-context-block", text: props.summary });
  }

  const bar = root.createDiv({ cls: "bunsho-decision-bar" });
  button(bar, "This is deliberate", "is-success", props.onDeliberate);
  button(bar, "Dismiss", "", props.onDismiss);
  if (props.onNext) button(bar, "Next Issue →", "is-next", props.onNext);
}
