/** Confirms "Delete my Bunsho data", saying exactly what goes and what stays. Resolves true only on an explicit "Delete". */
import { Modal, Setting, type App } from "obsidian";

export const DELETE_REMOVES = [
  "Your findings, and what you decided about them",
  "The World: what checks read from your book",
  "Your canon: every fact, name and character you declared",
  "Your Director scenes, and any draft you have not kept. Scenes you kept stay in your notes.",
  "Your reading plan, and what you chose to read",
] as const;

export function confirmDeleteData(app: App, otherAccounts: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new Modal(app);
    modal.titleEl.setText("Delete my Bunsho data?");
    modal.contentEl.createEl("p", { text: "This removes, from this vault's plugin folder:" });
    const list = modal.contentEl.createEl("ul");
    for (const line of DELETE_REMOVES) list.createEl("li", { text: line });
    if (otherAccounts) modal.contentEl.createEl("p", { text: "It also removes the same data kept here for another Bunsho account that signed in on this vault." });
    modal.contentEl.createEl("p", { text: "This cannot be undone. A check that is running stops. Your notes are not touched, you stay signed in if you are, and your credits and Bunsho account do not change." });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText("Not now").onClick(() => { answered = true; resolve(false); modal.close(); }))
      .addButton((b) => { b.setButtonText("Delete").onClick(() => { answered = true; resolve(true); modal.close(); }); b.buttonEl.addClass("mod-warning"); });
    modal.onClose = () => { if (!answered) resolve(false); };
    modal.open();
  });
}
