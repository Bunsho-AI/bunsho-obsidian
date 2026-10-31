/**
 * The one structure Bunsho reads in a vault (there is no other layout, by design):
 *
 *   <manuscript folder>/            default "Manuscript"
 *     01 The Arrival.md             one note per chapter, directly in the folder
 *     02 The Letter.md              story order = the notes sorted by name, numbers compared as numbers
 *
 * A paragraph is one line of a note. Frontmatter, %%comments%% and embeds are not part of the text.
 */
import { createHash } from "node:crypto";
import { projectMarkdown, type Projection } from "./projection";
import { PIPELINE_V3_LIMITS } from "./vendor/pipelineV3.types";
import { paragraphCount } from "./paragraphs";

export const DEFAULT_MANUSCRIPT_FOLDER = "Manuscript";

export interface NoteInput { path: string; basename: string; text: string }

export interface Chapter {
  /** The note's path: the page id the engine and the findings use. */
  pageId: string;
  /** 0-based story order. */
  order: number;
  title: string;
  /** The projected text sent to the engine. */
  text: string;
  /** Content hash of `text`: the page revision. */
  rev: string;
  projection: Projection;
}

export interface SkippedNote { path: string; reason: "empty" }

export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function buildChapters(notes: readonly NoteInput[]): { chapters: Chapter[]; skipped: SkippedNote[] } {
  const skipped: SkippedNote[] = [];
  const ready: Array<{ note: NoteInput; projection: Projection }> = [];
  for (const note of [...notes].sort((a, b) => collator.compare(a.basename, b.basename) || a.path.localeCompare(b.path))) {
    const projection = projectMarkdown(note.text);
    if (!projection.text.trim()) { skipped.push({ path: note.path, reason: "empty" }); continue; }
    ready.push({ note, projection });
  }
  const chapters = ready.map(({ note, projection }, order): Chapter => ({
    pageId: note.path, order, title: note.basename, text: projection.text, rev: sha256(projection.text), projection,
  }));
  return { chapters, skipped };
}

/** The manuscript snapshot id (desktop manuscriptSnapshotId): citations carry it back so a result can be matched to the text sent. */
export function snapshotId(chapters: readonly Pick<Chapter, "pageId" | "order" | "text">[]): string {
  return sha256(JSON.stringify([...chapters].sort((a, b) => a.order - b.order)
    .map(({ pageId, order, text }) => ({ pageId, pageOrder: order, rev: sha256(text), length: text.length }))));
}

/** Words for the price line: whitespace-separated runs, a rough count only (never sent anywhere). */
export const roughWords = (text: string): number => (text.match(/\S+/gu) ?? []).length;

/**
 * Chapters the engine would refuse, said before anything is sent and naming the note. The engine refuses these too
 * (uncharged), but with a generic message.
 */
export function chapterProblems(chapters: readonly Chapter[]): string[] {
  const problems: string[] = [];
  for (const chapter of chapters) {
    const name = `“${chapter.title}”`;
    if (chapter.pageId.length > PIPELINE_V3_LIMITS.maxIdChars) problems.push(`${name}: its path is too long. Use a shorter folder or note name.`);
    else if (chapter.text.length > PIPELINE_V3_LIMITS.maxPageChars
      || Math.ceil(Buffer.byteLength(chapter.text, "utf8") / PIPELINE_V3_LIMITS.bytesPerTokenEstimate) > PIPELINE_V3_LIMITS.maxPageTokens) {
      problems.push(`${name} is too long to check as one chapter. Split it into two chapter notes.`);
    } else if (paragraphCount(chapter.text) > PIPELINE_V3_LIMITS.maxParagraphsPerWholePage) {
      problems.push(`${name} has more than ${PIPELINE_V3_LIMITS.maxParagraphsPerWholePage.toLocaleString("en-US")} paragraphs. Split it into two chapter notes.`);
    }
  }
  return problems;
}
