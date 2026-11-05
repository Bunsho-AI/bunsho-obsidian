/**
 * From the writer's own layout to the pages the engine reads.
 *
 * The writer picks a folder (any depth) or one note. Every note, or every heading section of a note that needs dividing,
 * becomes an item on the reading plan, which the writer confirms: nothing about order or inclusion is guessed. Confirmed
 * items become reading units (lib/reading/units.ts), which are never shown. Only structure and sizes are read, never
 * words, so all of this holds in every language.
 */
import { countWords } from "@/lib/contract/countWords";
import { PIPELINE_V3_LIMITS } from "@/lib/contract/pipelineV3.types";
import { buildReadingUnits, READING_LIMITS, type ReadingUnit, type SourceHeading } from "@/lib/reading/units";
import { sha256 } from "@/utils/hash";
import { projectMarkdown, type Projection } from "@/utils/markdown";
import { paragraphCount } from "@/utils/paragraphs";

export interface SourceChoice { kind: "folder" | "note"; path: string }

export interface NoteInput {
  /** Survives renames (see moveNoteIds); finding identity hangs off it. */
  noteId: string;
  path: string;
  basename: string;
  text: string;
  /** The writer marked this note out of their word count (Novel Word Count's markers): it starts unticked. */
  leaveOut?: boolean;
}

/** One line of the reading plan. */
export interface ReadingItem {
  id: string;
  noteId: string;
  path: string;
  label: string;
  /** The item's stretch of the note's projected text. */
  from: number;
  text: string;
  headings: SourceHeading[];
  leaveOut: boolean;
  /** The note's whole projected text. */
  projectedNote: string;
}

export interface PlannedItem extends ReadingItem { included: boolean }

/** What the writer confirmed. Ids, so a rename or a move does not undo it. */
export interface SavedPlan { order: string[]; excluded: string[] }

/** A unit's place in the writer's vault: what a finding maps back through. */
export interface PageMeta {
  pageId: string;
  order: number;
  rev: string;
  /** The item this page came from, as the plan names it. */
  sourceId: string;
  label: string;
  noteId: string;
  path: string;
  /** Where the page's text starts in the note's projected text. */
  noteOffset: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural order, folder by folder. */
export function comparePaths(a: string, b: string): number {
  const [left, right] = [a.replace(/\.md$/u, "").split("/"), b.replace(/\.md$/u, "").split("/")];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order = collator.compare(left[i], right[i]);
    if (order !== 0) return order;
  }
  return left.length - right.length || a.localeCompare(b);
}

/** The vault root is "/". */
export function sourceContains(source: SourceChoice, path: string): boolean {
  if (source.kind === "note") return path === source.path;
  return path.endsWith(".md") && (source.path === "/" || source.path === "" || path.startsWith(`${source.path}/`));
}

/** The note's label: its path below the chosen folder, in the writer's terms. */
function noteLabel(note: NoteInput, source: SourceChoice): string {
  if (source.kind === "note") return note.basename;
  const root = source.path === "/" || source.path === "" ? "" : `${source.path}/`;
  return note.path.slice(root.length).replace(/\.md$/u, "").split("/").join(" / ");
}

/** The offsets where a note divides: the highest heading level that occurs at least twice. */
function divisions(projection: Projection): number[] {
  const levels = [...new Set(projection.headings.map((h) => h.level))].sort((a, b) => a - b);
  const level = levels.find((l) => projection.headings.filter((h) => h.level === l).length >= 2);
  return level === undefined ? [] : projection.headings.filter((h) => h.level === level).map((h) => h.offset);
}

function noteItems(note: NoteInput, projection: Projection, source: SourceChoice): ReadingItem[] {
  const text = projection.text;
  const label = noteLabel(note, source);
  const item = (id: string, itemLabel: string, from: number, to: number): ReadingItem => ({
    id, noteId: note.noteId, path: note.path, label: itemLabel, from, text: text.slice(from, to), leaveOut: note.leaveOut ?? false, projectedNote: text,
    headings: projection.headings.filter((h) => h.offset > from && h.offset < to).map((h) => ({ offset: h.offset - from, level: h.level })),
  });
  // A chapter note in a folder is the chapter, whatever its subheadings. One note holding the book, or a note too long to
  // send well, is listed by heading so research under a header can be left out.
  const cuts = source.kind === "note" || text.length > READING_LIMITS.wholeChars ? divisions(projection) : [];
  if (cuts.length === 0) return [item(note.noteId, label, 0, text.length)];

  const sections = cuts.map((from, i) => {
    const to = cuts[i + 1] ?? text.length;
    const [line, ...body] = text.slice(from, to).split("\n");
    return { from, to, line: line.trim(), body: body.find((l) => l.trim())?.trim() ?? "" };
  });
  const repeats = new Map<string, number>();
  for (const { line } of sections) repeats.set(line, (repeats.get(line) ?? 0) + 1);
  const seen = new Map<string, number>();
  const items: ReadingItem[] = [];
  if (text.slice(0, cuts[0]).trim()) items.push(item(`${note.noteId}#0`, label, 0, cuts[0]));
  for (const { from, to, line, body } of sections) {
    // A heading names its section, unless the note repeats it: then the id must follow the text, so swapping two sections
    // cannot quietly move an exclusion onto the other one.
    const key = sha256((repeats.get(line) ?? 0) > 1 ? `${line}\n${body}` : line).slice(0, 10);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    const heading = line || label;
    items.push(item(`${note.noteId}#${key}${count > 1 ? `.${count}` : ""}`, source.kind === "note" ? heading : `${label} / ${heading}`, from, to));
  }
  return items;
}

const noteIdOf = (itemId: string): string => itemId.split("#", 1)[0];

/** Every item of the source in natural order, and the notes with nothing to read. */
export function buildItems(notes: readonly NoteInput[], source: SourceChoice): { items: ReadingItem[]; skipped: string[] } {
  const skipped: string[] = [];
  const items: ReadingItem[] = [];
  for (const note of [...notes].sort((a, b) => comparePaths(a.path, b.path))) {
    const projection = projectMarkdown(note.text);
    if (!projection.text.trim()) { skipped.push(note.path); continue; }
    items.push(...noteItems(note, projection, source));
  }
  return { items, skipped };
}

/**
 * The items in the writer's order with their exclusions. An item the plan has never seen goes after its natural neighbour,
 * and any difference from what was confirmed asks the writer to look again. When a note is divided differently than it was
 * (it grew past the size that lists it by heading, say), a part the writer left out must not come back ticked: any new item of
 * a note with a saved exclusion starts unticked.
 */
export function applyPlan(items: readonly ReadingItem[], plan: SavedPlan | null): { items: PlannedItem[]; needsConfirming: boolean } {
  if (!plan) return { items: items.map((item) => ({ ...item, included: !item.leaveOut })), needsConfirming: true };
  const byId = new Map(items.map((item) => [item.id, item]));
  const excluded = new Set(plan.excluded);
  const notesWithExclusions = new Set(plan.excluded.map(noteIdOf));
  const ordered: ReadingItem[] = plan.order.flatMap((id) => { const item = byId.get(id); return item ? [item] : []; });
  const known = new Set(plan.order);
  let added = false;
  items.forEach((item, i) => {
    if (known.has(item.id)) return;
    added = true;
    const previous = items[i - 1];
    ordered.splice(previous ? ordered.findIndex((o) => o.id === previous.id) + 1 : 0, 0, item);
  });
  const missing = plan.order.some((id) => !byId.has(id));
  return {
    items: ordered.map((item) => ({ ...item, included: known.has(item.id) ? !excluded.has(item.id) : !item.leaveOut && !notesWithExclusions.has(item.noteId) })),
    needsConfirming: added || missing,
  };
}

/** The reading units for the included items, and where each one sits in the vault. */
export function buildUnits(items: readonly PlannedItem[], hash: (text: string) => string = sha256): { units: ReadingUnit[]; pages: PageMeta[] } {
  const included = items.filter((item) => item.included);
  const byId = new Map(included.map((item) => [item.id, item]));
  const units = buildReadingUnits(included.map((item) => ({ sourceId: item.id, label: item.label, text: item.text, headings: item.headings })), { hash });
  const pages = units.map((unit): PageMeta => {
    const item = byId.get(unit.sourceId);
    if (!item) throw new Error("A reading unit lost its source."); // buildReadingUnits only echoes the ids it was given
    return { pageId: unit.pageId, order: unit.order, rev: unit.rev, sourceId: item.id, label: unit.label, noteId: item.noteId, path: item.path, noteOffset: item.from + unit.sourceOffset };
  });
  return { units, pages };
}

/** The item a position in a note belongs to: the one holding the offset, else the note's nearest before it, else its first. */
export function itemAtOffset(items: readonly PlannedItem[], noteId: string, offset: number | null): PlannedItem | null {
  const own = items.filter((item) => item.included && item.noteId === noteId).sort((a, b) => a.from - b.from);
  if (offset === null) return own[0] ?? null;
  return [...own].reverse().find((item) => item.from <= offset) ?? own[0] ?? null;
}

export interface PlanQuote { chars: number; words: number; units: number; sources: number; hasParts: boolean; problems: string[] }

/** Exactly what the plan would send, and anything the engine would refuse. Hashes nothing, so the plan screen can call it on every tick. */
export function planQuote(items: readonly PlannedItem[]): PlanQuote {
  const { units } = buildUnits(items, () => "");
  return {
    chars: units.reduce((n, u) => n + u.text.length, 0), words: units.reduce((n, u) => n + countWords(u.text), 0),
    hasParts: units.some((u) => u.part !== undefined), units: units.length, sources: items.filter((item) => item.included).length, problems: sourceProblems(units),
  };
}

/** What the engine would refuse, said before anything is sent and in the writer's terms. Uses the core's own limits. */
export function sourceProblems(units: readonly Pick<ReadingUnit, "label" | "text">[]): string[] {
  const problems: string[] = [];
  if (units.length > PIPELINE_V3_LIMITS.maxPages) problems.push(`This book divides into too many pieces to check at once (${units.length.toLocaleString("en-US")}, the limit is ${PIPELINE_V3_LIMITS.maxPages}). Leave some out of the reading plan.`);
  if (units.reduce((n, u) => n + u.text.length, 0) > PIPELINE_V3_LIMITS.maxBookChars) problems.push(`This is too long to check at once (the limit is ${PIPELINE_V3_LIMITS.maxBookChars.toLocaleString("en-US")} characters). Leave some out of the reading plan.`);
  for (const unit of units) {
    const name = `\u201c${unit.label}\u201d`;
    if (unit.text.length > PIPELINE_V3_LIMITS.maxPageChars || Math.ceil(Buffer.byteLength(unit.text, "utf8") / PIPELINE_V3_LIMITS.bytesPerTokenEstimate) > PIPELINE_V3_LIMITS.maxPageTokens) {
      problems.push(`${name} has a single paragraph too long to read. Add a line break somewhere inside it.`);
    } else if (paragraphCount(unit.text) > PIPELINE_V3_LIMITS.maxParagraphsPerWholePage) {
      problems.push(`${name} has too many very short lines in one place. Split the note, or leave it out of the reading plan.`);
    }
  }
  return problems;
}

const isUnder = (path: string, parent: string): boolean => path === parent || path.startsWith(`${parent}/`);

/** The note-id map after a rename. A renamed folder moves everything under it, and what moved wins over a stale entry at the new path. */
export function moveNoteIds(ids: Readonly<Record<string, string>>, oldPath: string, newPath: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [path, id] of Object.entries(ids)) if (!isUnder(path, oldPath)) next[path] = id;
  for (const [path, id] of Object.entries(ids)) if (isUnder(path, oldPath)) next[`${newPath}${path.slice(oldPath.length)}`] = id;
  return next;
}

/** The note-id map after a delete, so a new note at that path is a new note to the plan. */
export function dropNoteIds(ids: Readonly<Record<string, string>>, path: string): Record<string, string> {
  return Object.fromEntries(Object.entries(ids).filter(([known]) => !isUnder(known, path)));
}

export const holdsNoteId = (ids: Readonly<Record<string, string>>, path: string): boolean => Object.keys(ids).some((known) => isUnder(known, path));

/** The manuscript snapshot id (desktop manuscriptSnapshotId): citations carry it back so a result can be matched to the text sent. */
export function snapshotId(pages: readonly Pick<ReadingUnit, "pageId" | "order" | "text">[]): string {
  return sha256(JSON.stringify([...pages].sort((a, b) => a.order - b.order)
    .map(({ pageId, order, text }) => ({ pageId, pageOrder: order, rev: sha256(text), length: text.length }))));
}
