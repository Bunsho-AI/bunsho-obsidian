import { Fact } from "@/atoms/Fact";
import { TextAction } from "@/atoms/TextAction";
import { EmptyState } from "@/molecules/EmptyState";
import { GroupHeader } from "@/molecules/GroupHeader";
import { FindingCard, type FindingCardProps } from "@/organisms/FindingCard";

/** Findings grouped as the desktop groups them, with the "Not an error" footer. */
export type FindingItem = Omit<FindingCardProps, "rank1" | "dismissed"> & { id: string };

export interface FindingsListProps {
  open: FindingItem[];
  dismissed: FindingItem[];
  anyFindings: boolean;
  chaptersChecked: number;
  chaptersTotal: number;
  showDismissed: boolean;
  onToggleShowDismissed: () => void;
}

export function FindingsList(parent: HTMLElement, props: FindingsListProps): void {
  const rank1 = props.open.filter((f) => f.severity === "error");
  const lower = props.open.filter((f) => f.severity !== "error");
  const unread = props.chaptersTotal - props.chaptersChecked;

  if (props.open.length === 0) {
    const box = EmptyState(parent, { title: props.anyFindings ? "No open findings" : "No contradictions found" });
    Fact(box, `${props.chaptersChecked}/${props.chaptersTotal} chapters checked`);
  } else if (unread > 0) {
    Fact(parent, `${unread} of ${props.chaptersTotal} chapters could not be read and were not checked`, "bunsho-note");
  }

  const section = (label: string, items: FindingItem[], isRank1: boolean) => {
    if (items.length === 0) return;
    GroupHeader(parent, label, items.length, isRank1);
    const list = parent.createDiv({ cls: "bunsho-list" });
    for (const item of items) FindingCard(list, { ...item, rank1: isRank1, dismissed: false });
  };
  section("Open contradiction", rank1, true);
  section("Worth a look", lower, false);

  if (props.dismissed.length > 0) {
    const footer = parent.createDiv({ cls: "bunsho-footer" });
    footer.createSpan({ text: `${props.dismissed.length} marked not an error \u00b7 ` });
    TextAction(footer, { label: props.showDismissed ? "Hide" : "Show", onClick: props.onToggleShowDismissed });
    if (props.showDismissed) {
      const list = parent.createDiv({ cls: "bunsho-list" });
      for (const item of props.dismissed) FindingCard(list, { ...item, rank1: false, dismissed: true });
    }
  }
}
