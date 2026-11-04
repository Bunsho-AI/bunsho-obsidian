/**
 * Reading units: the pages sent to the engine, built from whatever structure the writer keeps. A writer never sees them.
 *
 * Files and tabs are always boundaries. A section the engine can read well is sent whole, however short (the engine groups
 * short pages itself). A longer one is divided at its highest headings, and what is still too long is cut into parts at
 * scene breaks or paragraph ends. Only structure and sizes are read, never words, so this holds in every language.
 *
 * Sizes come from the engine's fact budget (claims.config.ts, stages/read.ts): a read lists at most 48 facts per pass, so a
 * page past 33,600 characters loses fact density; a part from 3k to 5k is the costliest shape to search; overlap is paid for
 * twice and pairs a paragraph with itself.
 *
 * Runs in Obsidian and in Apps Script: no Buffer, no node:crypto, no TextEncoder. The hash is the host's.
 */
import { isSceneBreak, paragraphs, type Paragraph } from "./paragraphs";

export const READING_LIMITS = Object.freeze({
  /** Up to here a section is sent whole. */
  wholeChars: 33_600,
  /** Mechanical parts: a cut falls in this range from the part's start. */
  minPartChars: 8_000,
  maxPartChars: 16_000,
  /** The last part folds into the one before when it would be shorter than this. */
  minTailChars: 5_000,
  /** MAX_V3_PAGE_TOKENS, MAX_V3_PARAGRAPHS_PER_PAGE (engine transport/protocol.ts). */
  maxPageTokens: 90_000,
  maxPageParagraphs: 1_200,
});

/** Bumped when the cutting rules change, so reads cached under the old rules are not reused. */
const UNITS_VERSION = "units-v1";

export interface SourceHeading {
  /** Offset of the heading's line in `SourceText.text`. */
  offset: number;
  /** 1 is the highest level. */
  level: number;
}

export interface SourceText {
  /** Stable across edits and reorders: never a position. */
  sourceId: string;
  label: string;
  text: string;
  headings?: readonly SourceHeading[];
}

export interface UnitPart {
  sourceId: string;
  sourceOrder: number;
  index: number;
  of: number;
}

export interface ReadingUnit {
  pageId: string;
  order: number;
  rev: string;
  text: string;
  sourceId: string;
  label: string;
  /** Where `text` starts in the source. A unit is one contiguous slice, so unit offset + this = source offset. */
  sourceOffset: number;
  /** Present only on a mechanical cut: the engine must not read the part's edges as a chapter's. */
  part?: UnitPart;
}

export interface BuildOptions {
  /** The host's content hash. */
  hash(text: string): string;
  /** Bench only: cut sections shorter than the real threshold. */
  wholeChars?: number;
  minPartChars?: number;
  maxPartChars?: number;
  minTailChars?: number;
}

/** FNV-1a. Picks cut points and short ids; it does not need to resist anyone. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const shortHash = (text: string): string => fnv1a(text).toString(36);

/** Engine estimateTokens: ceil(UTF-8 bytes / 2.5). */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return bytes;
}

interface Slice { from: number; to: number; id: string; label: string; cut: boolean }

function tooLong(text: string, wholeChars: number): boolean {
  return text.length > wholeChars || Math.ceil(utf8Bytes(text) / 2.5) > READING_LIMITS.maxPageTokens
    || paragraphs(text).length > READING_LIMITS.maxPageParagraphs;
}

/**
 * Part boundaries, as indexes of the paragraph that starts each part after the first. Inside each window the cut goes after
 * a scene break when there is one, otherwise before the paragraph with the lowest hash. Choosing by content, and not by
 * position, means an edit moves only nearby cuts and later ones fall back into place, with nothing stored.
 */
function partStarts(paras: readonly Paragraph[], base: number, end: number, opts: Required<Pick<BuildOptions, "minPartChars" | "maxPartChars" | "minTailChars">>): number[] {
  const starts: number[] = [];
  let first = 0;
  const startOf = (i: number) => paras[i]?.start ?? end;
  for (;;) {
    const from = startOf(first) ?? base;
    if (end - from <= opts.maxPartChars) return starts;
    const candidates: number[] = [];
    for (let i = first + 1; i < paras.length; i++) {
      const size = paras[i].start - from;
      if (size < opts.minPartChars) continue;
      if (size > opts.maxPartChars) break;
      if (end - paras[i].start >= opts.minTailChars) candidates.push(i);
    }
    let cut: number | undefined;
    const afterBreak = candidates.filter((i) => isSceneBreak(paras[i - 1]) && !isSceneBreak(paras[i]));
    const pool = afterBreak.length ? afterBreak : candidates;
    for (const i of pool) if (cut === undefined || fnv1a(paras[i].text) < fnv1a(paras[cut].text)) cut = i;
    if (cut === undefined) {
      // One paragraph runs past the window. Cut at the next paragraph end, or send the rest as one piece.
      const next = paras.findIndex((p, i) => i > first && p.start - from >= opts.minPartChars && end - p.start >= opts.minTailChars);
      if (next < 0) return starts;
      cut = next;
    }
    starts.push(cut);
    first = cut;
  }
}

/** Divides a stretch of a source at its highest headings, then cuts what is still too long. */
function sliceSection(source: SourceText, from: number, to: number, id: string, label: string, opts: Required<Omit<BuildOptions, "hash">>, seen: Map<string, number>): Slice[] {
  const text = source.text.slice(from, to);
  if (!text.trim()) return [];
  if (!tooLong(text, opts.wholeChars)) return [{ from, to, id, label, cut: false }];

  const inside = (source.headings ?? []).filter((h) => h.offset > from && h.offset < to);
  if (inside.length) {
    const top = Math.min(...inside.map((h) => h.level));
    const bounds = [from, ...inside.filter((h) => h.level === top).map((h) => h.offset), to];
    return bounds.slice(0, -1).flatMap((start, i) => {
      const end = bounds[i + 1];
      const line = source.text.slice(start, end).split("\n", 1)[0].trim();
      const key = `${id}#${shortHash(line)}`;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      // Text before the first heading has no heading of its own, so it keeps the stretch's label.
      return sliceSection(source, start, end, count > 1 ? `${key}.${count}` : key, i === 0 && start === from && !inside.some((h) => h.offset === start) ? label : line || label, opts, seen);
    });
  }

  const paras = paragraphs(text);
  const starts = partStarts(paras, 0, text.length, opts);
  if (!starts.length) return [{ from, to, id, label, cut: false }];
  const edges = [0, ...starts.map((i) => paras[i].start), text.length];
  return edges.slice(0, -1).map((start, i) => ({ from: from + start, to: from + edges[i + 1], id, label, cut: true }));
}

export function buildReadingUnits(sources: readonly SourceText[], options: BuildOptions): ReadingUnit[] {
  const opts = {
    wholeChars: options.wholeChars ?? READING_LIMITS.wholeChars,
    minPartChars: options.minPartChars ?? READING_LIMITS.minPartChars,
    maxPartChars: options.maxPartChars ?? READING_LIMITS.maxPartChars,
    minTailChars: options.minTailChars ?? READING_LIMITS.minTailChars,
  };
  const units: ReadingUnit[] = [];
  let sourceOrder = 0;
  for (const source of sources) {
    const slices = sliceSection(source, 0, source.text.length, source.sourceId, source.label, opts, new Map());
    const groups = new Map<string, Slice[]>();
    for (const slice of slices) groups.set(slice.id, [...(groups.get(slice.id) ?? []), slice]);
    for (const [id, group] of groups) {
      const ids = new Map<string, number>();
      group.forEach((slice, index) => {
        const raw = source.text.slice(slice.from, slice.to);
        const lead = raw.length - raw.trimStart().length;
        const text = raw.trim();
        let pageId = id;
        if (slice.cut) {
          const anchor = `${id}~${shortHash(paragraphs(text)[0]?.text ?? "")}`;
          const count = (ids.get(anchor) ?? 0) + 1;
          ids.set(anchor, count);
          pageId = count > 1 ? `${anchor}.${count}` : anchor;
        }
        units.push({
          pageId, order: units.length, rev: options.hash(`${UNITS_VERSION}\n${text}`), text, sourceId: source.sourceId, label: slice.label,
          sourceOffset: slice.from + lead,
          ...(slice.cut ? { part: { sourceId: id, sourceOrder, index, of: group.length } } : {}),
        });
      });
      sourceOrder++;
    }
  }
  return units;
}

/** Offset in the unit's text -> offset in its source. */
export const toSourceOffset = (unit: Pick<ReadingUnit, "sourceOffset">, offset: number): number => unit.sourceOffset + offset;
