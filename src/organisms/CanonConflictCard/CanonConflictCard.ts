import { Fact } from "@/atoms/Fact";
import { FillButton } from "@/atoms/FillButton";
import { SeverityLabel, type Severity } from "@/atoms/SeverityLabel";
import { TextAction } from "@/atoms/TextAction";
import { SpectrumPill } from "@/molecules/SpectrumPill";

/** A finding against the writer's canon (desktop CanonConflictCard): what this page says, and what they declared. The two halves stack, as they do on the desktop below 520px. */
export interface CanonConflictCardProps {
  id: string;
  severity: Severity;
  title: string;
  quote: string;
  coordinate: string;
  factLabel: string;
  value: string;
  mark: string;
  more: readonly string[];
  factId: string;
  onResolve: () => void;
  onDismiss: () => void;
}

export function CanonConflictCard(parent: HTMLElement, props: CanonConflictCardProps): void {
  const card = parent.createDiv({ cls: "bunsho-card is-rank1 bunsho-canon-card", attr: { "data-issue-type": "canon_conflict" } });
  const labels = card.createDiv({ cls: "bunsho-canon-labels" });
  SeverityLabel(labels, props.severity);
  SpectrumPill(labels, "factual");
  card.createDiv({ cls: "bunsho-claim", text: props.title });

  const page = card.createDiv({ cls: "bunsho-compare" });
  page.createSpan({ cls: "bunsho-caps", text: "This page" });
  page.createDiv({ cls: "bunsho-compare-quote", text: props.quote });
  Fact(page, props.coordinate, "bunsho-coords");
  const canon = card.createDiv({ cls: "bunsho-compare" });
  canon.createSpan({ cls: "bunsho-caps", text: "Canon" });
  const line = canon.createDiv({ cls: "bunsho-world-fact" });
  line.createSpan({ cls: "bunsho-world-label", text: props.factLabel });
  line.createSpan({ cls: "bunsho-world-value is-canon", text: props.value });
  Fact(canon, props.mark, "bunsho-coords");

  for (const extra of props.more) Fact(card.createDiv({ cls: "bunsho-compare-more" }), extra);

  const foot = card.createDiv({ cls: "bunsho-canon-card-foot" });
  const actions = foot.createDiv({ cls: "bunsho-actions" });
  FillButton(actions, { label: "Resolve", small: true, focusKey: `resolve:${props.id}`, onClick: props.onResolve });
  TextAction(actions, { label: "Not an error", quiet: true, focusKey: `dismiss:${props.id}`, onClick: props.onDismiss });
  Fact(foot, props.factId, "bunsho-coords");
}
