import { setIcon } from "obsidian";
import { SPECTRUM_CONFIG, type SpectrumKey } from "@/helpers/spectrum";

/** A finding's kind: hue text on a tint of itself. Category, never urgency. */
export function SpectrumPill(parent: HTMLElement, spectrum: SpectrumKey): HTMLElement {
  const pill = parent.createSpan({ cls: "bunsho-pill", attr: { "data-spectrum": spectrum } });
  setIcon(pill.createSpan({ cls: "bunsho-pill-icon", attr: { "aria-hidden": "true" } }), SPECTRUM_CONFIG[spectrum].icon);
  pill.createSpan({ text: SPECTRUM_CONFIG[spectrum].label });
  return pill;
}
