/** Reading the writer's chosen source out of the vault (Obsidian API glue; the rules themselves are in helpers/sources.ts). */
import { getAllTags, MarkdownView, TFile, TFolder, type App } from "obsidian";
import { comparePaths, sourceContains, type NoteInput, type SourceChoice } from "@/helpers/sources";

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

/** Novel Word Count's markers: the writer has already said this note is not story. It starts unticked and they can change that. */
function markedOut(app: App, file: TFile): boolean {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return false;
  return cache.frontmatter?.wordcount === false || (getAllTags(cache) ?? []).includes("#exclude-from-word-count");
}

/** Whether the source is still in the vault. */
export function sourceExists(app: App, source: SourceChoice): boolean {
  if (source.kind === "note") return app.vault.getFileByPath(source.path) !== null;
  return app.vault.getFolderByPath(source.path) !== null;
}

/** Every note of the source, with its current text; null when the source is gone. */
export async function readSourceNotes(app: App, source: SourceChoice, idFor: (path: string) => string): Promise<NoteInput[] | null> {
  if (!sourceExists(app, source)) return null;
  const files = app.vault.getMarkdownFiles().filter((f) => sourceContains(source, f.path));
  return Promise.all(files.map(async (f) => ({ noteId: idFor(f.path), path: f.path, basename: f.basename, text: await readNoteText(app, f), leaveOut: markedOut(app, f) })));
}

export interface SourceOption extends SourceChoice { label: string }

/** What the writer can pick: folders that hold notes (the vault itself included) and single notes. */
export function sourceOptions(app: App): SourceOption[] {
  const options: SourceOption[] = [];
  for (const entry of app.vault.getAllLoadedFiles()) {
    if (entry instanceof TFolder) {
      const label = entry.isRoot() ? "Whole vault" : `${entry.path}/`;
      if (app.vault.getMarkdownFiles().some((f) => sourceContains({ kind: "folder", path: entry.path }, f.path))) options.push({ kind: "folder", path: entry.path, label });
    } else if (entry instanceof TFile && entry.extension === "md") {
      options.push({ kind: "note", path: entry.path, label: entry.path.replace(/\.md$/u, "") });
    }
  }
  // Folders first, as most books are one. The whole vault last: it usually holds more than the story.
  const rank = (option: SourceOption) => (option.path === "/" ? 2 : option.kind === "folder" ? 0 : 1);
  return options.sort((a, b) => rank(a) - rank(b) || comparePaths(a.path, b.path));
}
