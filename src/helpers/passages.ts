/**
 * Local context for a chapter-scoped review (desktop passageSelection.ts, and fitCachedReads from runPipelineV3Review.ts).
 *
 * The checked chapters go to the engine whole. Every other chapter contributes only the paragraphs that mention someone the
 * checked chapters mention, so the engine never receives text the writer did not ask to have checked beyond what the check
 * needs. The names come from the engine's own extracted structure (the stored cast and the cached reads), never a word list.
 *
 * Descriptions a reader recorded as names ("the old man") are left out of matching: they would select most of the book.
 * Matching is case-insensitive. A name must not run into another letter of a cased script ("Al" does not match "also");
 * scripts without letter case match as substrings, because many are written without spaces between words.
 */
import { nameKey as subjectKey } from "@/helpers/world";
import { PIPELINE_V3_LIMITS, type CastMember, type ChapterRead, type PipelineV3PassagesFrame } from "@/lib/contract/pipelineV3.types";
import { paragraphs } from "@/lib/reading/paragraphs";

export interface PassagePage { pageId: string; pageOrder: number; text: string }

/** Per other page, most-relevant first. */
export const MAX_PASSAGES_PER_PAGE = 40;
/** All passage text in one review; the engine refuses more than 400,000 (MAX_V3_PASSAGE_CHARS). */
export const MAX_PASSAGE_TOTAL_CHARS = 350_000;
const MAX_NAME_CHARS = 120;
const MAX_TERMS = 4_000;

/** One individual's searchable names. */
export type NameGroup = readonly string[];

export function castNameGroups(cast: readonly CastMember[], reads: readonly ChapterRead[]): NameGroup[] {
  return [
    ...cast.map((member) => [member.name, ...member.properNames, ...member.aliases]),
    ...reads.flatMap((read) => read.cast.map((record) => [record.name,
      ...record.names.filter((entry) => entry.proper).map((entry) => entry.name),
      ...record.introducedAliases.map((entry) => entry.alias)])),
  ];
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** A lone letter of a cased script ("I", "A") is a pronoun or article far more often than a name. */
const usableName = (name: string): boolean => name.length > 0 && name.length <= MAX_NAME_CHARS && !(Array.from(name).length === 1 && /\p{LC}/u.test(name));

interface Matcher { pattern: RegExp; groupOf: Map<string, number> }
function matcher(groups: readonly NameGroup[]): Matcher | null {
  const groupOf = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const raw of group) {
      const name = raw.trim();
      if (usableName(name) && !groupOf.has(name.toLowerCase()) && groupOf.size < MAX_TERMS) groupOf.set(name.toLowerCase(), index);
    }
  });
  if (groupOf.size === 0) return null;
  const alternation = [...groupOf.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  return { pattern: new RegExp(`(?<![\\p{LC}\\p{N}_])(?:${alternation})(?![\\p{LC}\\p{N}_])`, "giu"), groupOf };
}

/** The individuals (group indexes) named in `text`; -1 stands for a match whose case folding has no key. */
function namedGroups(m: Matcher, text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.matchAll(m.pattern)) found.add(m.groupOf.get(match[0].toLowerCase()) ?? -1);
  return found;
}

export interface PassageSelection {
  /** One frame per other page, in the order given (a page with nothing relevant sends no paragraphs). */
  passages: PipelineV3PassagesFrame[];
  /** Individuals the checked chapters mention. */
  individuals: number;
  chars: number;
}

export interface CastFocus {
  /** Every name and description the cast gives the people the checked chapters involve (the engine's focusNames). */
  focusNames: string[];
  /** Per other page: paragraphs holding a story fact about one of them, however the fact names them. */
  factParagraphs: Map<string, Set<number>>;
}

/**
 * A chapter check picks the rest of the book by facts, not by name spelling. The people the checked chapters involve are the
 * cast members they name or that their own reads record; through the cast (the last full review's), a fact recorded under
 * "the burly gentleman" or a paragraph that says only "she" still counts for them.
 */
export function castFocus(input: { cast: readonly CastMember[]; checked: readonly PassagePage[]; reads: readonly ChapterRead[] }): CastFocus {
  const memberOf = new Map<string, number>();
  input.cast.forEach((member, index) => {
    for (const name of [member.name, ...member.names, ...member.properNames, ...member.aliases]) {
      const key = subjectKey(name);
      if (key && !memberOf.has(key)) memberOf.set(key, index);
    }
  });
  const involved = new Set<number>();
  const named = matcher(input.cast.map((member) => [member.name, ...member.properNames, ...member.aliases]));
  if (named) for (const page of input.checked) for (const group of namedGroups(named, page.text)) if (group >= 0) involved.add(group);
  const checkedIds = new Set(input.checked.map((page) => page.pageId));
  for (const read of input.reads) {
    if (!checkedIds.has(read.pageId)) continue;
    for (const name of [...read.facts.map((fact) => fact.subject), ...read.cast.flatMap((record) => [record.name, ...record.names.map((entry) => entry.name)])]) {
      const member = memberOf.get(subjectKey(name));
      if (member !== undefined) involved.add(member);
    }
  }
  const focusNames = [...new Set([...involved].sort((a, b) => a - b).flatMap((index) => {
    const member = input.cast[index];
    return [member.name, ...member.names, ...member.properNames, ...member.aliases].map((name) => name.trim());
  }))].filter((name) => name.length > 0 && name.length <= MAX_NAME_CHARS).slice(0, PIPELINE_V3_LIMITS.maxFocusNames);
  const factParagraphs = new Map<string, Set<number>>();
  for (const read of input.reads) {
    if (checkedIds.has(read.pageId)) continue;
    for (const fact of read.facts) {
      const member = memberOf.get(subjectKey(fact.subject));
      if (member === undefined || !involved.has(member)) continue;
      const held = factParagraphs.get(read.pageId) ?? new Set<number>();
      held.add(fact.paragraph);
      factParagraphs.set(read.pageId, held);
    }
  }
  return { focusNames, factParagraphs };
}

export function selectPassages(input: {
  checked: readonly PassagePage[];
  others: readonly PassagePage[];
  nameGroups: readonly NameGroup[];
  /** castFocus's fact paragraphs: sent first, whether or not they name anyone. */
  factParagraphs?: ReadonlyMap<string, ReadonlySet<number>>;
  maxPerPage?: number;
  maxTotalChars?: number;
}): PassageSelection {
  const maxPerPage = input.maxPerPage ?? MAX_PASSAGES_PER_PAGE;
  let budget = input.maxTotalChars ?? MAX_PASSAGE_TOTAL_CHARS;
  const all = matcher(input.nameGroups);
  const mentioned = new Set<number>();
  if (all) for (const page of input.checked) for (const group of namedGroups(all, page.text)) if (group >= 0) mentioned.add(group);
  const relevant = all && mentioned.size ? matcher(input.nameGroups.map((group, index) => (mentioned.has(index) ? group : []))) : null;

  const selected = new Map<string, PipelineV3PassagesFrame["paragraphs"]>();
  if (relevant || input.factParagraphs?.size) {
    const distance = (page: PassagePage): number => Math.min(...input.checked.map((checked) => Math.abs(checked.pageOrder - page.pageOrder)));
    // Nearest chapters first: when the budget runs out, the context closest to the checked chapters survives.
    const queue = [...input.others].sort((a, b) => distance(a) - distance(b) || a.pageOrder - b.pageOrder);
    for (const page of queue) {
      const facts = input.factParagraphs?.get(page.pageId);
      const ranked = paragraphs(page.text)
        .filter((paragraph) => paragraph.text.length <= PIPELINE_V3_LIMITS.maxParagraphChars)
        .map((paragraph) => ({ paragraph, fact: facts?.has(paragraph.index) ?? false, weight: relevant ? namedGroups(relevant, paragraph.text).size : 0 }))
        .filter((entry) => entry.fact || entry.weight > 0)
        .sort((a, b) => Number(b.fact) - Number(a.fact) || b.weight - a.weight || a.paragraph.index - b.paragraph.index);
      const kept: PipelineV3PassagesFrame["paragraphs"] = [];
      for (const { paragraph } of ranked) {
        if (kept.length >= maxPerPage) break;
        if (paragraph.text.length > budget) continue;
        budget -= paragraph.text.length;
        kept.push(paragraph);
      }
      selected.set(page.pageId, kept.sort((a, b) => a.index - b.index));
    }
  }
  const passages = input.others.map((page) => ({ pageId: page.pageId, paragraphs: selected.get(page.pageId) ?? [] }));
  return { passages, individuals: mentioned.size, chars: passages.reduce((sum, entry) => sum + entry.paragraphs.reduce((n, p) => n + p.text.length, 0), 0) };
}

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

/** Room left in the start frame for everything but the cached reads (the engine takes 8 MiB per frame). */
const START_FRAME_MARGIN_BYTES = 256 * 1024;
export const cachedReadBudget = (startWithoutReads: unknown): number => PIPELINE_V3_LIMITS.maxFrameBytes - START_FRAME_MARGIN_BYTES - bytes(startWithoutReads);

/**
 * Cached reads that fit one start frame: the checked chapters' own reads first (they save the most engine work), then the
 * other chapters nearest the checked ones (the most likely context).
 */
export function fitCachedReads(reads: readonly ChapterRead[], checkedOrders: readonly number[], checkedIds: ReadonlySet<string>, budget: number): ChapterRead[] {
  const distance = (read: ChapterRead): number => (checkedIds.has(read.pageId) ? -1 : Math.min(...checkedOrders.map((order) => Math.abs(order - read.order))));
  const kept: ChapterRead[] = [];
  let used = 0;
  for (const read of [...reads].sort((a, b) => distance(a) - distance(b) || a.order - b.order)) {
    if (kept.length >= PIPELINE_V3_LIMITS.maxPages) break;
    const size = bytes(read) + 1;
    if (used + size > budget) continue;
    used += size;
    kept.push(read);
  }
  return kept.sort((a, b) => a.order - b.order);
}
