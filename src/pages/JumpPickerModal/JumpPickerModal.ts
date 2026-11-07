/** The Jump to issue picker. A transient overlay, as on the desktop; only the Jump button opens it. */
import { Modal, type App } from "obsidian";
import type { EngineIssue } from "@/lib/contract/engine.types";
import { JumpPicker } from "@/organisms/JumpPicker";

/** Resolves the finding picked, or null when the writer closes the picker. */
export function pickIssue(app: App, open: readonly EngineIssue[], coordinate: (issue: EngineIssue) => string): Promise<EngineIssue | null> {
  return new Promise((resolve) => {
    let picked: EngineIssue | null = null;
    const modal = new Modal(app);
    modal.modalEl.addClass("bunsho-picker-modal");
    modal.titleEl.setText("Jump to issue");
    const field = JumpPicker(modal.contentEl, { open, coordinate, onSelect: (issue) => { picked = issue; modal.close(); } });
    modal.onClose = () => resolve(picked);
    modal.open();
    field.focus();
  });
}
