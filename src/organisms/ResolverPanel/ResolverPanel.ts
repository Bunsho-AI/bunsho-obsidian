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
  /** A decision is being saved, or a check is running. */
  busy: boolean;
  /** Check if fixed: the one filled control, with its price on it. Null when it cannot run. */
  recheck: { price: string; checking: boolean; onClick: () => void } | null;
  /** What the last Check if fixed found. The message is shown as it came. */
  feedback: { tone: "success" | "danger"; message: string } | null;
  onJump: (() => void) | null;
  onClose: () => void;
  onDeliberate: () => void;
  onDismiss: () => void;
  onNext: (() => void) | null;
}

function block(parent: HTMLElement, label: string, loud: boolean, passage: ResolverPassage, index: number): void {
  const card = parent.createDiv({ cls: `bunsho-card${loud ? " is-rank1" : ""}` });
  card.createSpan({ cls: loud ? "bunsho-severity" : "bunsho-caps", text: label });
  card.createDiv({ cls: "bunsho-rail-quote", text: `“${passage.quote}”` });
  const foot = card.createDiv({ cls: "bunsho-card-foot" });
  Fact(foot, passage.coordinate, "bunsho-coords");
  TextAction(foot, { label: "Open", plain: true, focusKey: `resolver:open:${index}`, onClick: passage.onOpen });
}

function button(parent: HTMLElement, label: string, cls: string, key: string, busy: boolean, onClick: () => void): void {
  const element = parent.createEl("button", { cls: `bunsho-decision ${cls}`, text: label, attr: { "data-focus-key": `resolver:${key}` } });
  element.disabled = busy;
  element.onclick = onClick;
}

export function ResolverPanel(parent: HTMLElement, props: ResolverPanelProps): void {
  const root = parent.createDiv({ cls: "bunsho-resolver" });
  const head = root.createDiv({ cls: "bunsho-resolver-head" });
  head.createDiv({ cls: "bunsho-resolver-title", text: props.claim });
  const close = head.createEl("button", { cls: "bunsho-resolver-close", text: "×", attr: { "aria-label": "Close", "data-focus-key": "resolver:close" } });
  close.onclick = props.onClose;

  if (props.onJump) TextAction(root.createDiv({ cls: "bunsho-resolver-jump" }), { label: "Jump to issue", quiet: true, focusKey: "jump:open", onClick: props.onJump });

  const rail = root.createDiv({ cls: "bunsho-list" });
  props.passages.forEach((passage, index) => block(rail, index === 0 ? "This page" : "Contradicts", index === 0, passage, index));
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

  if (props.feedback) root.createDiv({ cls: `bunsho-feedback is-${props.feedback.tone}`, text: props.feedback.message, attr: { role: "status" } });
  const bar = root.createDiv({ cls: "bunsho-decision-bar" });
  if (props.recheck) {
    const { recheck } = props;
    const fill = bar.createEl("button", { cls: "bunsho-recheck", attr: { "data-focus-key": "resolver:recheck" } });
    fill.createSpan({ text: recheck.checking ? "Checking..." : "Check if fixed" });
    if (!recheck.checking) fill.createSpan({ cls: "bunsho-recheck-price", text: recheck.price });
    fill.disabled = props.busy;
    fill.onclick = recheck.onClick;
  }
  button(bar, "This is deliberate", "is-success", "deliberate", props.busy, props.onDeliberate);
  button(bar, "Dismiss", "", "dismiss", props.busy, props.onDismiss);
  if (props.onNext) button(bar, "Next Issue →", "is-next", "next", props.busy, props.onNext);
}
