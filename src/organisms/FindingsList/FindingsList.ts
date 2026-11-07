import { Fact } from "@/atoms/Fact";
import { TextAction } from "@/atoms/TextAction";
import { EmptyState } from "@/molecules/EmptyState";
import { GroupHeader } from "@/molecules/GroupHeader";
import type { Resolution } from "@/helpers/findings";
import { FindingCard, type FindingCardProps } from "@/organisms/FindingCard";

/** Findings grouped as the desktop groups them, ending with what the writer has settled. */
export type FindingItem = Omit<FindingCardProps, "rank1">;

export interface ResolvedItem { id: string; claim: string; status: Resolution; onRestore: () => void }

/** What the check read, always stated: a silent partial read is the failure Bunsho refuses to repeat. */
export interface FindingsCoverage { read: number; total: number; excluded: number; noun: string; unreadLabels: string[] }

export interface FindingsListProps {
  open: FindingItem[];
  resolved: ResolvedItem[];
  anyFindings: boolean;
  coverage: FindingsCoverage;
  showResolved: boolean;
  onToggleShowResolved: () => void;
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
    for (const item of items) FindingCard(list, { ...item, rank1: isRank1 });
  };
  section("Open contradiction", rank1, true);
  section("Worth a look", lower, false);

  if (props.resolved.length > 0) {
    const footer = parent.createDiv({ cls: "bunsho-footer" });
    footer.createSpan({ text: `${props.resolved.length} resolved this session \u00b7 ` });
    TextAction(footer, { label: props.showResolved ? "Hide" : "Show", plain: true, focusKey: "resolved:toggle", onClick: props.onToggleShowResolved });
    if (props.showResolved) {
      const list = parent.createDiv({ cls: "bunsho-list bunsho-resolved" });
      for (const item of props.resolved) {
        const row = list.createDiv({ cls: "bunsho-card bunsho-resolved-row" });
        row.createSpan({ cls: "bunsho-claim bunsho-resolved-claim", text: item.claim, attr: { title: item.claim } });
        const end = row.createSpan({ cls: "bunsho-actions" });
        Fact(end, item.status, "bunsho-resolved-status");
        TextAction(end, { label: "Restore", quiet: true, focusKey: `restore:${item.id}`, onClick: item.onRestore });
      }
    }
  }
}
