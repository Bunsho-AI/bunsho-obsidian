/** Opening a chapter note and selecting a finding's passage in it. */
import { MarkdownView, Notice, type App } from "obsidian";
import { locateQuote } from "@/helpers/locate";
import type { EngineIssueCitation } from "@/lib/contract/engine.types";
import { sha256 } from "@/utils/hash";
import { projectMarkdown } from "@/utils/markdown";

export async function selectPassage(app: App, citation: EngineIssueCitation): Promise<void> {
  const file = app.vault.getFileByPath(citation.page_id);
  if (!file) { new Notice("That chapter note has been moved or renamed since the check."); return; }
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  const view = leaf.view;
  if (!(view instanceof MarkdownView)) return;
  // Offsets come from the editor's own text, so they always match what offsetToPos counts.
  const projection = projectMarkdown(view.editor.getValue());
  const hit = locateQuote(citation, projection, sha256(projection.text));
  if (!hit) { new Notice("This passage has changed since the check. Run the check again."); return; }
  const from = view.editor.offsetToPos(hit.from);
  const to = view.editor.offsetToPos(hit.to);
  view.editor.setSelection(from, to);
  view.editor.scrollIntoView({ from, to }, true);
}
