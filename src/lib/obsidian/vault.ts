/** Reading the manuscript out of the vault (Obsidian API glue; the chapter rules themselves are in helpers/chapters.ts). */
import { MarkdownView, type App, type TFile } from "obsidian";
import type { NoteInput } from "@/helpers/chapters";
import { isChapterPath } from "@/helpers/chapters";

/** Obsidian's editor holds LF text; files written elsewhere may have CRLF. One line-ending everywhere keeps offsets aligned. */
const lf = (text: string): string => text.replace(/\r\n?/gu, "\n");

/** The note as the writer sees it: the open editor's text when the note is open (it may not be saved yet), else the file. */
export async function readNoteText(app: App, file: TFile): Promise<string> {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file?.path === file.path) return lf(view.editor.getValue());
  }
  return lf(await app.vault.read(file));
}

/** Every chapter note of the manuscript folder, with its current text; null when the folder does not exist. */
export async function readManuscriptNotes(app: App, folder: string): Promise<NoteInput[] | null> {
  if (!app.vault.getFolderByPath(folder)) return null;
  const files = app.vault.getMarkdownFiles().filter((f) => isChapterPath(f.path, folder));
  return Promise.all(files.map(async (f) => ({ path: f.path, basename: f.basename, text: await readNoteText(app, f) })));
}
