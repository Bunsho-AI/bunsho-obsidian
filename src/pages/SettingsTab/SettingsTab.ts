/** Plugin settings. Signed out, only the account and privacy sections show (nothing works without a sign-in). */
import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { ContinuityController } from "@/controllers/ContinuityController";
import { DEFAULT_MANUSCRIPT_FOLDER } from "@/helpers/chapters";
import { isLocalEngine } from "@/utils/url";

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private readonly controller: ContinuityController) { super(app, plugin); }

  display(): void {
    const c = this.controller;
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Account").setDesc(c.account.signedIn ? "Signed in. Checks use your Bunsho credits." : "Sign in with the Google account you use for Bunsho.")
      .addButton((b) => b.setButtonText(c.account.signedIn ? "Sign out" : "Sign in with Google").onClick(async () => {
        if (c.account.signedIn) await c.signOut(); else await c.signIn();
        this.display();
      }));
    new Setting(containerEl).setName("Privacy").setDesc("Your chapter notes are sent to the Bunsho service, over an encrypted connection, only when you confirm a check. While you are signed in, the plugin also reads your credit balance and the current price. The plugin sends no analytics.");
    if (!c.account.signedIn) return;
    new Setting(containerEl).setName("Manuscript folder")
      .setDesc("One note per chapter, directly inside this folder. Chapters are read in name order (01, 02, ... 10), one paragraph per line.")
      .addText((t) => t.setPlaceholder(DEFAULT_MANUSCRIPT_FOLDER).setValue(c.data.manuscriptFolder).onChange((value) => void c.setManuscriptFolder(value)));
    new Setting(containerEl).setName("Engine address").setDesc("Leave this alone unless Bunsho support asks you to change it. Only Bunsho's own addresses are accepted.")
      .addText((t) => t.setValue(c.data.engineUrl).onChange((value) => void c.setEngineUrl(value)));
    if (isLocalEngine(c.data.engineUrl)) {
      new Setting(containerEl).setName("Developer user ID").setDesc("For a local development engine only.")
        .addText((t) => t.setValue(c.data.devUid).onChange((value) => void c.setDevUid(value)));
    }
  }
}
