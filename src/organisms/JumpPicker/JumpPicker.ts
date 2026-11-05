import { setIcon } from "obsidian";
import { Fact } from "@/atoms/Fact";
import { displayIssueTitle, getIssueSpectrum, pickerGroups } from "@/helpers/spectrum";
import type { EngineIssue } from "@/lib/contract/engine.types";
import { SpectrumPill } from "@/molecules/SpectrumPill";

/** "Jump to issue": the open findings, grouped as the panel groups them, with a filter on their titles. */
export interface JumpPickerProps {
  open: readonly EngineIssue[];
  coordinate: (issue: EngineIssue) => string;
  onSelect: (issue: EngineIssue) => void;
}

/** Returns the field, which takes the keyboard when the picker opens. */
export function JumpPicker(parent: HTMLElement, { open, coordinate, onSelect }: JumpPickerProps): HTMLInputElement {
  const root = parent.createDiv({ cls: "bunsho-picker" });
  const head = root.createDiv({ cls: "bunsho-picker-head" });
  setIcon(head.createSpan({ cls: "bunsho-pill-icon", attr: { "aria-hidden": "true" } }), "search");
  const field = head.createEl("input", { cls: "bunsho-picker-field", attr: { type: "text", placeholder: "Filter open issues…", "aria-label": "Filter open issues" } });
  const count = Fact(head, "");
  const list = root.createDiv({ cls: "bunsho-picker-list" });

  const draw = (): void => {
    list.empty();
    const groups = pickerGroups(open, field.value);
    count.setText(String(groups.reduce((n, group) => n + group.issues.length, 0)));
    if (groups.length === 0) list.createEl("p", { cls: "bunsho-picker-none", text: "No matching issues" });
    for (const group of groups) {
      list.createDiv({ cls: `bunsho-picker-group${group.rank1 ? " is-rank1" : ""}`, text: group.label });
      for (const issue of group.issues) {
        const row = list.createEl("button", { cls: "bunsho-picker-row" });
        SpectrumPill(row, getIssueSpectrum(issue));
        row.createSpan({ cls: "bunsho-picker-title", text: displayIssueTitle(issue) });
        Fact(row, coordinate(issue), "bunsho-picker-coords");
        row.onclick = () => onSelect(issue);
      }
    }
  };
  field.addEventListener("input", draw);
  draw();
  return field;
}
