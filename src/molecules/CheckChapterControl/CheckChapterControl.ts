import { setIcon } from "obsidian";
import { Fact } from "@/atoms/Fact";
import { formatNumber } from "@/utils/format";

/**
 * "Check chapter" (desktop CheckChapterControl): the price first, in a small confirm under the button, and no credit spent
 * without a click on a button below that price. The desktop's sits in the chapter's own header, so it need not say which chapter;
 * in a side panel the writer can be anywhere, so this names it.
 */
export interface CheckChapterControlProps {
  /** The chapter under the writer's cursor. */
  label: string;
  /** The price the writer is looking at, while the confirm is open. */
  confirming: { label: string; credits: number } | null;
  onOpen: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CheckChapterControl(parent: HTMLElement, { label, confirming, onOpen, onCancel, onConfirm }: CheckChapterControlProps): void {
  const root = parent.createDiv({ cls: "bunsho-chapter-control" });
  const trigger = root.createEl("button", { cls: "bunsho-chapter-trigger", attr: { title: `Check “${label}”`, "data-focus-key": "chapter:open", "aria-expanded": String(Boolean(confirming)) } });
  setIcon(trigger.createSpan({ cls: "bunsho-pill-icon", attr: { "aria-hidden": "true" } }), "shield-check");
  trigger.createSpan({ text: "Check chapter" });
  trigger.onclick = onOpen;
  if (!confirming) return;

  const dialog = root.createDiv({ cls: "bunsho-chapter-confirm", attr: { role: "dialog", "aria-labelledby": "bunsho-chapter-line" } });
  dialog.createEl("p", { cls: "bunsho-chapter-line", text: `Check this chapter — ~${formatNumber(confirming.credits)} credits`, attr: { id: "bunsho-chapter-line" } });
  dialog.createEl("p", { cls: "bunsho-chapter-body", text: "Bunsho re-reads this chapter and checks it against your story so far." });
  Fact(dialog, confirming.label, "bunsho-chapter-name");
  const actions = dialog.createDiv({ cls: "bunsho-chapter-actions" });
  const cancel = actions.createEl("button", { cls: "bunsho-chapter-cancel", text: "Cancel", attr: { "data-focus-key": "chapter:cancel" } });
  cancel.onclick = onCancel;
  const confirm = actions.createEl("button", { cls: "bunsho-fill is-small", text: "Check now", attr: { "data-focus-key": "chapter:confirm" } });
  confirm.onclick = onConfirm;
  dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } });
}
