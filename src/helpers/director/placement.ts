/**
 * Where Keep puts a scene, and what it puts. Pure, so every rule can be held against real note text. The note's projection (what Bunsho reads) is what a position is
 * in, because frontmatter and comments can change without the story moving, and it is mapped back to the note only to write.
 *
 * A note's paragraph is one line, and markup can span the cursor, so a place is always the next line boundary: a scene is never put through the middle of a line, a link or
 * a bold run. "End of chapter" is the end of that plan item, not the note.
 */
import { buildItems, type NoteInput, type ReadingItem, type SourceChoice } from "@/helpers/sources";
import { sha256 } from "@/utils/hash";
import { projectMarkdown, type Projection } from "@/utils/markdown";

/** The place "at the cursor" meant when the scene was written: an offset in the projected note, and a hash of all the text before it. */
export interface PlacementMark { offset: number; before: string }

export type InsertWhere = "cursor" | "end";
export interface InsertPlan {
  /** Offset in the note's LF text. */
  offset: number;
  text: string;
  at: InsertWhere;
  /** The item was gone, so the end was the note's. */
  noteEnd: boolean;
}
export type PlanOutcome = { kind: "insert"; plan: InsertPlan } | { kind: "already" };

/** The prose as the note holds it: paragraphs a blank line apart, nothing else changed. */
export const keptBlock = (prose: string): string => prose.split(/\n{2,}/u).map((p) => p.trim()).filter(Boolean).join("\n\n");

const lineStart = (raw: string, at: number): boolean => at === 0 || raw[at - 1] === "\n";

/** Past a fenced block that holds `at`, by the shape of its fence lines. */
function pastFence(raw: string, at: number): number {
  let opened: number | null = null;
  let offset = 0;
  for (const line of raw.split("\n")) {
    const end = offset + line.length;
    if (/^ {0,3}(`{3,}|~{3,})/u.test(line)) {
      if (opened !== null && opened < at && offset >= at) return Math.min(raw.length, end + 1);
      opened = opened === null ? offset : null;
    }
    offset = end + 1;
  }
  return at;
}

/** The boundary a place resolves to: where it is, if it opens a line; else the end of its line; and never inside a fence. */
function snap(raw: string, at: number): number {
  const place = pastFence(raw, at);
  if (lineStart(raw, place)) return place;
  const end = raw.indexOf("\n", place);
  return end === -1 ? raw.length : end;
}

/** A projected offset as a place in the note. toSourceEnd keeps it before a removed heading mark, and snap carries it past a closing mark. */
const boundaryAt = (raw: string, projection: Projection, offset: number): number => snap(raw, projection.toSourceEnd(offset));

/** What a scene written at this cursor continues from and comes back to, when the cursor is in the chapter [from, to] of the projected note. Null when it is elsewhere. */
export function cursorContext(raw: string, cursor: number, from: number, to: number): { mark: PlacementMark; preceding: string } | null {
  const projection = projectMarkdown(raw);
  const offset = projection.fromSource(snap(raw, Math.min(cursor, raw.length)));
  if (offset < from || offset > to) return null;
  return { mark: { offset, before: sha256(projection.text.slice(0, offset)) }, preceding: projection.text.slice(from, offset) };
}

/** The saved place, if everything before it still reads the same. */
function markedPlace(raw: string, projection: Projection, mark: PlacementMark | undefined): number | null {
  if (!mark || mark.offset > projection.text.length || sha256(projection.text.slice(0, mark.offset)) !== mark.before) return null;
  return boundaryAt(raw, projection, mark.offset);
}

function padded(raw: string, offset: number, block: string): string {
  const before = raw.slice(0, offset);
  const after = raw.slice(offset);
  const prefix = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  if (after.trim() === "") return `${prefix}${block}${after === "" && before.endsWith("\n") ? "\n" : ""}`;
  const suffix = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  return `${prefix}${block}${suffix}`;
}

export interface PlanInsertInput {
  /** The note's LF text as it is now. */
  raw: string;
  note: Pick<NoteInput, "noteId" | "path" | "basename">;
  source: SourceChoice;
  itemId: string;
  placement: "append" | "cursor";
  mark?: PlacementMark;
  prose: string;
}

/** Where this goes, read off the note as it is now. A scene already in the note, word for word, is not placed again. */
export function planInsert(input: PlanInsertInput): PlanOutcome {
  const { raw, note, source, itemId, placement, mark, prose } = input;
  const block = keptBlock(prose);
  if (block && raw.includes(block)) return { kind: "already" };
  const projection = projectMarkdown(raw);
  const marked = placement === "cursor" ? markedPlace(raw, projection, mark) : null;
  if (marked !== null) return { kind: "insert", plan: { offset: marked, text: padded(raw, marked, block), at: "cursor", noteEnd: false } };
  const item = itemOf(raw, note, source, itemId);
  const to = item ? item.from + item.text.length : projection.text.length;
  const offset = to >= projection.text.length ? raw.length : boundaryAt(raw, projection, to);
  return { kind: "insert", plan: { offset, text: padded(raw, offset, block), at: "end", noteEnd: !item } };
}

const itemOf = (raw: string, note: PlanInsertInput["note"], source: SourceChoice, itemId: string): ReadingItem | null =>
  buildItems([{ ...note, text: raw }], source).items.find((item) => item.id === itemId) ?? null;
