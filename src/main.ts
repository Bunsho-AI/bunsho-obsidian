/** Plugin entry: registers the icon, the panel, commands and settings, and hands everything else to the controller. */
import { addIcon, Plugin, type WorkspaceLeaf } from "obsidian";
import { BUNSHO_ICON_ID, BUNSHO_ICON_SVG } from "@/assets/logo";
import { ContinuityController } from "@/controllers/ContinuityController";
import { confirmCheck } from "@/pages/ConfirmCheckModal";
import { confirmReplaceProject } from "@/pages/ConfirmReplaceProjectModal";
import { reviewPlan } from "@/pages/ReadingPlanModal";
import { pickSource } from "@/pages/SourcePickerModal";
import { ContinuityView, VIEW_TYPE } from "@/pages/ContinuityView";
import { SettingsTab } from "@/pages/SettingsTab";
import type { PluginData } from "@/types";

export default class BunshoPlugin extends Plugin {
  private controller!: ContinuityController;

  async onload(): Promise<void> {
    addIcon(BUNSHO_ICON_ID, BUNSHO_ICON_SVG);
    this.controller = new ContinuityController({
      app: this.app,
      version: this.manifest.version,
      loadData: () => this.loadData(),
      saveData: (data: PluginData) => this.saveData(data),
      openPanel: () => this.openPanel(),
      confirmCheck: (quote) => confirmCheck(this.app, quote),
      reviewPlan: (request) => reviewPlan(this.app, request),
      pickSource: (options) => pickSource(this.app, options),
      confirmReplaceProject: (name) => confirmReplaceProject(this.app, name),
      changed: () => this.renderViews(),
    });
    await this.controller.load();

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new ContinuityView(leaf, this.controller));
    this.addRibbonIcon(BUNSHO_ICON_ID, "Bunsho: continuity", () => void this.openPanel());
    this.addCommand({ id: "open-panel", name: "Open continuity panel", callback: () => void this.openPanel() });
    this.addCommand({ id: "check-manuscript", name: "Check manuscript", callback: () => void this.controller.check() });
    this.addCommand({ id: "reading-plan", name: "Reading plan", callback: () => void this.controller.editPlan() });
    this.addCommand({ id: "choose-source", name: "Choose what to read", callback: () => void this.controller.chooseSource() });
    this.addCommand({ id: "sign-in", name: "Sign in with Google", callback: () => void this.controller.signIn() });
    this.addCommand({ id: "sign-out", name: "Sign out", callback: () => void this.controller.signOut() });
    this.addSettingTab(new SettingsTab(this.app, this, this.controller));

    // The vault is not indexed until the workspace is ready; registering earlier would scan once per file at startup.
    this.app.workspace.onLayoutReady(() => {
      void this.controller.refresh();
      const warn = (error: unknown) => console.warn("[Bunsho] could not save", error);
      const onChange = (path: string, oldPath?: string) => { if (this.controller.touchesSource(path, oldPath)) this.controller.scheduleScan(); };
      this.registerEvent(this.app.vault.on("create", (file) => onChange(file.path)));
      this.registerEvent(this.app.vault.on("delete", (file) => { void this.controller.deleted(file.path).catch(warn); onChange(file.path); }));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { void this.controller.moved(file.path, oldPath).catch(warn).finally(() => onChange(file.path, oldPath)); }));
      this.registerEvent(this.app.vault.on("modify", (file) => onChange(file.path))); // a note autosaves every couple of seconds while typing
    });
  }

  onunload(): void { this.controller?.dispose(); }

  private async openPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private renderViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ContinuityView) leaf.view.render();
  }
}
