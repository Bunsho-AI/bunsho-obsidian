/** Opening a note and selecting a finding's passage in it. */
import { MarkdownView, Notice, type App } from "obsidian";
import { locateQuote } from "@/helpers/locate";
import type { EngineIssueCitation } from "@/lib/contract/engine.types";
import { projectMarkdown } from "@/utils/markdown";

export async function selectPassage(app: App, path: string, pageOffset: number, citation: Pick<EngineIssueCitation, "quoted_text" | "source_ref">): Promise<void> {
  const file = app.vault.getFileByPath(path);
  if (!file) { new Notice("That note has been moved or deleted since the check."); return; }
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  const view = leaf.view;
  if (!(view instanceof MarkdownView)) return;
  // Offsets come from the editor's own text, so they always match what offsetToPos counts.
  const projection = projectMarkdown(view.editor.getValue());
  const hit = locateQuote(citation, projection, pageOffset);
  if (!hit) { new Notice("This passage has changed since the check. Run the check again."); return; }
  const from = view.editor.offsetToPos(hit.from);
  const to = view.editor.offsetToPos(hit.to);
  view.editor.setSelection(from, to);
  view.editor.scrollIntoView({ from, to }, true);
}
