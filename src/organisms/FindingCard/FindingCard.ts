import { Fact } from "@/atoms/Fact";
import { SeverityLabel, type Severity } from "@/atoms/SeverityLabel";
import { TextAction } from "@/atoms/TextAction";
import { Passage } from "@/molecules/Passage";

/**
 * A finding, as the desktop's card: rank 1 (error) has the danger rule, filled label and both passages always shown;
 * lower ranks are soft cards whose passages open from the coordinates line.
 */
export interface FindingPassage { quote: string; coordinate: string; shortCoordinate: string; onGo: () => void }

export interface FindingCardProps {
  claim: string;
  severity: Severity;
  passages: FindingPassage[];
  rank1: boolean;
  expanded: boolean;
  dismissed: boolean;
  onExpand: () => void;
  onToggleDismissed: () => void;
}

export function FindingCard(parent: HTMLElement, props: FindingCardProps): HTMLElement {
  const card = parent.createDiv({ cls: `bunsho-card${props.rank1 ? " is-rank1" : ""}${props.dismissed ? " is-dismissed" : ""}` });
  SeverityLabel(card, props.severity);
  card.createDiv({ cls: "bunsho-claim", text: props.claim });

  const open = props.rank1 || props.expanded;
  if (open) for (const passage of props.passages) Passage(card, passage);

  const foot = card.createDiv({ cls: "bunsho-card-foot" });
  if (open) foot.createSpan();
  else {
    const coords = Fact(foot, props.passages.map((p) => p.shortCoordinate).join(" \u00b7 "), "bunsho-coords is-clickable");
    coords.onclick = props.onExpand;
  }
  TextAction(foot.createSpan({ cls: "bunsho-actions" }), { label: props.dismissed ? "Restore" : "Not an error", quiet: true, onClick: props.onToggleDismissed });
  return card;
}
