import { Fact } from "@/atoms/Fact";
import { TextAction } from "@/atoms/TextAction";
import { EmptyState } from "@/molecules/EmptyState";
import { GroupHeader } from "@/molecules/GroupHeader";
import { FindingCard, type FindingCardProps } from "@/organisms/FindingCard";

/** Findings grouped as the desktop groups them, with the "Not an error" footer. */
export type FindingItem = Omit<FindingCardProps, "rank1" | "dismissed"> & { id: string };

/** What the check read, always stated: a silent partial read is the failure Bunsho refuses to repeat. */
export interface FindingsCoverage { read: number; total: number; excluded: number; noun: string; unreadLabels: string[] }

export interface FindingsListProps {
  open: FindingItem[];
  dismissed: FindingItem[];
  anyFindings: boolean;
  coverage: FindingsCoverage;
  showDismissed: boolean;
  onToggleShowDismissed: () => void;
}

export function FindingsList(parent: HTMLElement, props: FindingsListProps): void {
  const rank1 = props.open.filter((f) => f.severity === "error");
  const lower = props.open.filter((f) => f.severity !== "error");
  const { coverage } = props;

  if (props.open.length === 0) EmptyState(parent, { title: props.anyFindings ? "No open findings" : "No contradictions found" });
  const left = coverage.excluded > 0 ? ` \u00b7 ${coverage.excluded} left out by you` : "";
  Fact(parent, `${coverage.read} of ${coverage.total} ${coverage.noun} read in full${left}`, "bunsho-note");
  if (coverage.unreadLabels.length > 0) {
    parent.createDiv({ cls: "bunsho-problem bunsho-note", text: `Not fully checked: ${coverage.unreadLabels.join(", ")}` });
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
