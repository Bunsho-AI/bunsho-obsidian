import { Fact } from "@/atoms/Fact";
import { SeverityLabel, type Severity } from "@/atoms/SeverityLabel";
import { TextAction } from "@/atoms/TextAction";

/**
 * A finding, as the desktop's card (IssueRow). Rank 1 (error): danger rule, filled label and one passage, always visible.
 * Lower ranks: a soft card with no passage. Both end with the coordinate, then "Not an error" and "Resolve".
 */
export interface FindingCardProps {
  id: string;
  claim: string;
  severity: Severity;
  quote: string | null;
  coordinate: string;
  rank1: boolean;
  onDismiss: () => void;
  onResolve: () => void;
}

export function FindingCard(parent: HTMLElement, props: FindingCardProps): HTMLElement {
  const card = parent.createDiv({ cls: `bunsho-card${props.rank1 ? " is-rank1" : ""}` });
  SeverityLabel(card, props.severity);
  card.createDiv({ cls: "bunsho-claim", text: props.claim });
  if (props.rank1 && props.quote) card.createDiv({ cls: "bunsho-card-quote", text: props.quote });

  const foot = card.createDiv({ cls: "bunsho-card-foot" });
  Fact(foot, props.coordinate, "bunsho-coords");
  const actions = foot.createSpan({ cls: "bunsho-actions" });
  TextAction(actions, { label: "Not an error", quiet: true, focusKey: `dismiss:${props.id}`, onClick: props.onDismiss });
  TextAction(actions, { label: "Resolve", plain: true, focusKey: `resolve:${props.id}`, onClick: props.onResolve });
  return card;
}
