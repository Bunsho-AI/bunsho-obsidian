import { QuietButton } from "@/atoms/QuietButton";
import { EmptyState } from "@/molecules/EmptyState";

/** The one manuscript layout Bunsho reads, shown when there are no chapters to check. */
export interface ManuscriptHelpProps { folder: string; folderExists: boolean; onCreateFolder: () => void }

export function ManuscriptHelp(parent: HTMLElement, { folder, folderExists, onCreateFolder }: ManuscriptHelpProps): HTMLElement {
  const box = EmptyState(parent, {
    title: "Nothing to check yet",
    body: folderExists ? `Add your chapters to \u201c${folder}\u201d, one note per chapter.`
      : `Bunsho reads your manuscript from a folder called \u201c${folder}\u201d, one note per chapter.`,
  });
  box.createEl("pre", { cls: "bunsho-tree", text: `${folder}/\n  01 The Arrival.md\n  02 The Letter.md\n  03 \u2026` });
  const rules = box.createEl("ul", { cls: "bunsho-rules" });
  rules.createEl("li", { text: "Chapters are read in name order, so number them: 01, 02, \u2026 10." });
  rules.createEl("li", { text: "One paragraph per line." });
  if (!folderExists) QuietButton(box, { label: `Create \u201c${folder}\u201d folder`, onClick: onCreateFolder });
  return box;
}
