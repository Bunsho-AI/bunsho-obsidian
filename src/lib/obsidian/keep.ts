/**
 * The only place the plugin writes into a manuscript. An open note changes through its editor, as one undo step. A closed note, or one in reading view, changes through vault.process, which is atomic but
 * outside any undo history, and the writer is told. Offsets are in the note's LF text; a file written elsewhere keeps its own line endings.
 */
import { MarkdownView, type App, type Editor, type TFile } from "obsidian";
import type { InsertPlan, PlanOutcome } from "@/helpers/director/placement";

export type PlaceResult =
  | { kind: "placed"; plan: InsertPlan; undoable: boolean }
  | { kind: "already" }
  | { kind: "missing" };

const lf = (text: string): string => text.replace(/\r\n?/gu, "\n");

/** An offset in the LF text as an offset in the file. */
function rawOffset(raw: string, offset: number): number {
  let seen = 0;
  for (let i = 0; i < raw.length; i++) {
    if (seen === offset) return i;
    if (raw[i] === "\r" && raw[i + 1] === "\n") i++;
    seen++;
  }
  return raw.length;
}

function openEditor(app: App, path: string): Editor | null {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const { view } = leaf;
    // A note in reading view has an editor that nothing saves: it is changed like a closed note, and the view follows the file.
    if (view instanceof MarkdownView && view.file?.path === path && view.getMode() === "source") return view.editor;
  }
  return null;
}

/** Puts a kept scene in the note. `decide` reads the note as it is at that moment, so nothing typed between the click and the write is missed. */
export async function placeInNote(app: App, path: string, decide: (text: string) => PlanOutcome): Promise<PlaceResult> {
  const file: TFile | null = app.vault.getFileByPath(path);
  if (!file) return { kind: "missing" };
  const editor = openEditor(app, path);
  if (editor) {
    const outcome = decide(lf(editor.getValue()));
    if (outcome.kind === "already") return { kind: "already" };
    const { plan } = outcome;
    const at = editor.offsetToPos(plan.offset);
    // One transaction is one undo step. No selection: the writer's cursor stays theirs, and is never replaced.
    editor.transaction({ changes: [{ from: at, text: plan.text }] });
    const start = editor.offsetToPos(plan.offset + plan.text.length - plan.text.trimStart().length);
    editor.scrollIntoView({ from: start, to: start }, true);
    return { kind: "placed", plan, undoable: true };
  }
  let result: PlaceResult = { kind: "already" };
  await app.vault.process(file, (data) => {
    const outcome = decide(lf(data));
    if (outcome.kind === "already") { result = { kind: "already" }; return data; }
    const { plan } = outcome;
    const eol = /\r\n/u.test(data) ? "\r\n" : "\n";
    const at = rawOffset(data, plan.offset);
    result = { kind: "placed", plan, undoable: false };
    return data.slice(0, at) + plan.text.replace(/\n/gu, eol) + data.slice(at);
  });
  return result;
}
