/** Plugin settings. Signed out, only the account and privacy sections show (nothing works without a sign-in). */
import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { ContinuityController } from "@/controllers/ContinuityController";
import { accountSummary } from "@/helpers/account";
import { HELP_CENTER_URL, SUPPORT_EMAIL, SUPPORT_REPLY_PROMISE } from "@/helpers/support";
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
    new Setting(containerEl).setName("Privacy").setDesc("The notes you choose are sent to the Bunsho service, over an encrypted connection, only when you confirm a check. While you are signed in, the plugin also reads your plan, your credit balance and the current price. The plugin sends no analytics.");
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
