/** Confirms switching the free plan's one project to this vault. Resolves true only on an explicit "Switch". */
import { Modal, Setting, type App } from "obsidian";

export function confirmReplaceProject(app: App, currentName: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new Modal(app);
    modal.titleEl.setText("Switch your free project?");
    modal.contentEl.createEl("p", { text: `This vault becomes your free project. Nothing is deleted, but Bunsho stops checking “${currentName ?? "your other manuscript"}” until you switch back. You can switch as often as you like.` });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText("Not now").onClick(() => { answered = true; resolve(false); modal.close(); }))
      .addButton((b) => b.setButtonText("Switch").setCta().onClick(() => { answered = true; resolve(true); modal.close(); }));
    modal.onClose = () => { if (!answered) resolve(false); };
    modal.open();
  });
}
