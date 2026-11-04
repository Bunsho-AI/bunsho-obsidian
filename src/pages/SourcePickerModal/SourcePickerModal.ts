/** Picks the folder or note Bunsho reads. Resolves null when the writer closes it. */
import { FuzzySuggestModal, type App } from "obsidian";
import type { SourceChoice } from "@/helpers/sources";
import type { SourceOption } from "@/lib/obsidian/vault";

class SourcePicker extends FuzzySuggestModal<SourceOption> {
  constructor(app: App, private readonly options: SourceOption[], private readonly done: (choice: SourceChoice | null) => void) {
    super(app);
    this.setPlaceholder("Choose the folder or note that holds your book");
  }
  getItems(): SourceOption[] { return this.options; }
  getItemText(option: SourceOption): string { return option.label; }
  onChooseItem(option: SourceOption): void { this.done({ kind: option.kind, path: option.path }); }
  // Obsidian closes the modal just before it reports the choice, so a choice must get the chance to arrive first.
  onClose(): void { super.onClose(); window.setTimeout(() => this.done(null), 0); }
}

export function pickSource(app: App, options: SourceOption[]): Promise<SourceChoice | null> {
  return new Promise((resolve) => { new SourcePicker(app, options, resolve).open(); });
}
