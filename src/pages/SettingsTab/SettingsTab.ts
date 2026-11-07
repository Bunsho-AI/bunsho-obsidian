/** Plugin settings. Signed out, only the account, privacy and delete sections show (nothing else works without a sign-in). */
import { Notice, PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { ContinuityController } from "@/controllers/ContinuityController";
import { accountSummary } from "@/helpers/account";
import { HELP_CENTER_URL, SUPPORT_EMAIL, SUPPORT_REPLY_PROMISE } from "@/helpers/support";
import { confirmDeleteData } from "@/pages/ConfirmDeleteDataModal";
import { isLocalEngine } from "@/utils/url";

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private readonly controller: ContinuityController) { super(app, plugin); }

  display(): void {
    const c = this.controller;
    const { containerEl } = this;
    containerEl.empty();
    const summary = accountSummary(c.account.planName, c.account.balance);
    new Setting(containerEl).setName("Account").setDesc(c.account.signedIn ? `Signed in.${summary ? ` ${summary}.` : ""} Checks use your Bunsho credits.` : "Sign in with the Google account you use for Bunsho.")
      .addButton((b) => b.setButtonText(c.account.signedIn ? "Sign out" : "Sign in with Google").onClick(async () => {
        if (c.account.signedIn) await c.signOut(); else await c.signIn();
        this.display();
      }));
    new Setting(containerEl).setName("Privacy").setDesc("The notes you choose are sent to the Bunsho service, over an encrypted connection, only when you confirm a check. While you are signed in, the plugin also reads your plan, your credit balance and the current price. The plugin sends no analytics. Your findings, what checks read and your canon stay on this machine when you sign out, ready for when you sign back in.");
    new Setting(containerEl).setName("Delete my Bunsho data").setDesc("Removes your findings and decisions, what checks read, your canon and your reading plan from this vault's plugin folder. Your notes are not touched.")
      .addButton((b) => {
        b.setButtonText("Delete my Bunsho data").onClick(async () => {
          if (!(await confirmDeleteData(this.app, c.holdsOtherAccounts()))) return;
          try {
            await c.deleteData();
            new Notice("Your Bunsho data on this vault is deleted.");
          } catch (error) {
            console.warn("[Bunsho] could not delete the data", error);
            new Notice("Bunsho could not delete all of it. Try again.");
          }
          this.display();
        });
        b.buttonEl.addClass("mod-warning");
      });
    if (!c.account.signedIn) return;
    new Setting(containerEl).setName("Contact support").setDesc(`Write to ${SUPPORT_EMAIL} and a person reads it. ${SUPPORT_REPLY_PROMISE} The plugin adds only its version, in the subject.`)
      .addButton((b) => b.setButtonText("Help center").onClick(() => window.open(HELP_CENTER_URL, "_external")))
      .addButton((b) => b.setButtonText("Email support").onClick(() => c.contactSupport()));
    new Setting(containerEl).setName("What Bunsho reads")
      .setDesc(c.data.source ? `\u201c${c.data.source.path === "/" ? "Whole vault" : c.data.source.path}\u201d. Any layout works: you confirm the order before a check.` : "Nothing chosen yet. Pick a folder or a note, in any layout.")
      .addButton((b) => b.setButtonText(c.data.source ? "Change" : "Choose").onClick(async () => { await c.chooseSource(); this.display(); }));
    new Setting(containerEl).setName("Engine address").setDesc("Leave this alone unless Bunsho support asks you to change it. Only Bunsho's own addresses are accepted.")
      .addText((t) => t.setValue(c.data.engineUrl).onChange((value) => void c.setEngineUrl(value)));
    if (isLocalEngine(c.data.engineUrl)) {
      new Setting(containerEl).setName("Developer user ID").setDesc("For a local development engine only.")
        .addText((t) => t.setValue(c.data.devUid).onChange((value) => void c.setDevUid(value)));
    }
  }
}
