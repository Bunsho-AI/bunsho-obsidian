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

/**
 * The note the writer is on and where their cursor is, in the note's projected text. The panel takes the focus when clicked, so
 * this asks for the active file and then finds that note's own editor.
 */
export function activeNotePosition(app: App): { path: string; offset: number | null } | null {
  const file = app.workspace.getActiveFile();
  if (!file) return null;
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file?.path === file.path) {
      return { path: file.path, offset: projectMarkdown(view.editor.getValue()).fromSource(view.editor.posToOffset(view.editor.getCursor())) };
    }
  }
  return { path: file.path, offset: null };
}
