/** The price confirmation every check goes through. Resolves true only on an explicit "Check". */
import { Modal, Setting, type App } from "obsidian";
import type { CheckQuote } from "@/controllers/ContinuityController";
import { formatNumber } from "@/utils/format";

export function confirmCheck(app: App, { chapters, words, credits, balance }: CheckQuote): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new Modal(app);
    modal.titleEl.setText("Check manuscript?");
    modal.contentEl.createEl("p", { text: `${chapters} ${chapters === 1 ? "chapter" : "chapters"}, about ${formatNumber(words)} words.` });
    modal.contentEl.createEl("p", { text: credits === null ? "The price could not be read. You will not be charged more than the engine quotes when it starts."
      : `This check costs about ${formatNumber(credits)} credits${balance === null ? "" : ` (you have ${formatNumber(balance)})`}.` });
    modal.contentEl.createEl("p", { text: "It takes a few minutes. Keep Obsidian open until it finishes.", cls: "bunsho-muted" });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText("Not now").onClick(() => { answered = true; resolve(false); modal.close(); }))
      .addButton((b) => b.setButtonText("Check").setCta().onClick(() => { answered = true; resolve(true); modal.close(); }));
    modal.onClose = () => { if (!answered) resolve(false); };
    modal.open();
  });
}
