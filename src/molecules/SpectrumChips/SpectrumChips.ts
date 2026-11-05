import { setIcon } from "obsidian";
import { SPECTRUM_CONFIG, type SpectrumKey } from "@/helpers/spectrum";

/** The kinds of finding on the panel, most first, each with its count. Filtering is free and local; a second click clears it. */
export interface SpectrumChipsProps {
  chips: ReadonlyArray<{ key: SpectrumKey; count: number }>;
  active: SpectrumKey | null;
  onSelect: (spectrum: SpectrumKey | null) => void;
}

export function SpectrumChips(parent: HTMLElement, { chips, active, onSelect }: SpectrumChipsProps): void {
  if (chips.length === 0) return;
  const row = parent.createDiv({ cls: "bunsho-chips" });
  for (const { key, count } of chips) {
    const selected = active === key;
    const chip = row.createEl("button", { cls: `bunsho-chip${selected ? " is-active" : ""}`, attr: { "data-spectrum": key, "data-focus-key": `chip:${key}`, "aria-pressed": String(selected) } });
    setIcon(chip.createSpan({ cls: "bunsho-pill-icon", attr: { "aria-hidden": "true" } }), SPECTRUM_CONFIG[key].icon);
    chip.createSpan({ text: SPECTRUM_CONFIG[key].label });
    chip.createSpan({ cls: "bunsho-chip-count", text: String(count) });
    chip.onclick = () => onSelect(selected ? null : key);
  }
}
