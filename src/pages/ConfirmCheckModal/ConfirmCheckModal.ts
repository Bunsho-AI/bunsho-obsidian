/** The price confirmation every check goes through. Resolves "check" only on an explicit "Check". */
import { Modal, Setting, type App } from "obsidian";
import { TextAction } from "@/atoms/TextAction";
import type { CheckAnswer, CheckQuote } from "@/controllers/ContinuityController";
import { formatNumber } from "@/utils/format";

export function confirmCheck(app: App, { sources, noun, words, credits, balance }: CheckQuote): Promise<CheckAnswer> {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (value: CheckAnswer) => { answered = true; resolve(value); modal.close(); };
    const modal = new Modal(app);
    modal.titleEl.setText("Check manuscript?");
    const size = modal.contentEl.createEl("p", { text: `${formatNumber(sources)} ${noun}, about ${formatNumber(words)} words. ` });
    TextAction(size, { label: "Review the reading plan", onClick: () => answer("plan") });
    modal.contentEl.createEl("p", { text: credits === null ? "The price could not be read. You will not be charged more than the engine quotes when it starts."
      : `This check costs about ${formatNumber(credits)} credits${balance === null ? "" : ` (you have ${formatNumber(balance)})`}.` });
    modal.contentEl.createEl("p", { text: "It takes a few minutes. Keep Obsidian open until it finishes.", cls: "bunsho-muted" });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText("Not now").onClick(() => answer("cancel")))
      .addButton((b) => b.setButtonText("Check").setCta().onClick(() => answer("check")));
    modal.onClose = () => { if (!answered) resolve("cancel"); };
    modal.open();
  });
}
