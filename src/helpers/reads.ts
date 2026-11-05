/**
 * The reads and cast a check leaves behind (desktop pipelineV3Store.ts). A chapter check sees the rest of the book only through
 * these, so they outlive the run that made them.
 *
 * Each read carries the read policy it was made under, and is sent back only under that policy and at the page's current
 * revision. A read whose policy is null is for the World tab only: an older file, one the engine refused, or one streamed under
 * another policy. The World shows a page as of its last check, so a page can hold that read and a newer one from a stopped run.
 */
import { validChapterRead } from "@/lib/contract/pipelineV3Frames";
import type { CastMember, ChapterRead } from "@/lib/contract/pipelineV3.types";

export interface KeptRead { readPolicyId: string | null; read: ChapterRead }

/** Page -> its last-checked revision: what the review's ledger says, as far as these rules care. */
type Checked = Readonly<Record<string, { rev: string }>>;

/**
 * Reads usable now: made under `readPolicyId`, for a page's current revision. A read whose chapter has since moved keeps its
 * content and takes the chapter's current story order, which is ours to say.
 */
export function usableReads(kept: readonly KeptRead[], readPolicyId: string, pages: ReadonlyArray<{ pageId: string; rev: string; order: number }>): ChapterRead[] {
  return pages.flatMap((page) => {
    const entry = [...kept].reverse().find((e) => e.readPolicyId === readPolicyId && e.read.pageId === page.pageId && e.read.rev === page.rev);
    if (!entry) return [];
    const { read } = entry;
    if (read.order === page.order) return [read];
    const { order } = page;
    const moved: ChapterRead = { ...read, order, facts: read.facts.map((fact) => ({ ...fact, order })),
      cast: read.cast.map((record) => ({ ...record, order })), povBreaks: read.povBreaks.map((pov) => ({ ...pov, order })) };
    return validChapterRead(moved) ? [moved] : [];
  });
}

/** What the World tab shows: each page's read at the revision it was last checked. */
export function worldReads(kept: readonly KeptRead[], checked: Checked): ChapterRead[] {
  const out = new Map<string, ChapterRead>();
  for (const { read } of kept) if (checked[read.pageId]?.rev === read.rev) out.set(read.pageId, read);
  return [...out.values()];
}

/** Keeps a page's checked read, and its latest while the page is in the book. Nothing else can be used again. */
export function pruneReads(kept: readonly KeptRead[], checked: Checked, inBook: ReadonlySet<string>): KeptRead[] {
  const latest = new Map<string, KeptRead>();
  const newestAt = new Map<string, KeptRead>();
  for (const entry of kept) {
    latest.set(entry.read.pageId, entry);
    newestAt.set(`${entry.read.pageId}\u0000${entry.read.rev}`, entry);
  }
  return kept.filter((entry) => newestAt.get(`${entry.read.pageId}\u0000${entry.read.rev}`) === entry
    && (checked[entry.read.pageId]?.rev === entry.read.rev || (inBook.has(entry.read.pageId) && latest.get(entry.read.pageId)?.read.rev === entry.read.rev)));
}

/** The engine refused a read, or streamed under another policy: none goes back to it. The World may still show them. */
export const forgetCached = (kept: readonly KeptRead[]): KeptRead[] => kept.map((entry) => ({ ...entry, readPolicyId: null }));

const nameKey = (name: string): string => name.trim().toLowerCase();
const memberKeys = (member: CastMember): Set<string> => new Set([member.name, ...member.properNames, ...member.aliases].map(nameKey).filter(Boolean));

/**
 * A full review's cast replaces the stored one. A chapter review may see only part of the book, so its members replace those
 * they share a name with and the rest are kept. The engine numbers each run's cast from zero and the World groups by id, so a
 * kept member whose id a new one took is given another.
 */
export function mergeCast(prior: readonly CastMember[], incoming: readonly CastMember[], scope: "full" | "chapters"): CastMember[] {
  if (scope === "full") return [...incoming];
  const names = new Set(incoming.flatMap((member) => [...memberKeys(member)]));
  const taken = new Set(incoming.map((member) => member.id));
  const kept = prior.filter((member) => ![...memberKeys(member)].some((key) => names.has(key))).map((member) => {
    let { id } = member;
    for (let n = 1; taken.has(id); n++) id = `${member.id}~${n}`;
    taken.add(id);
    return id === member.id ? member : { ...member, id };
  });
  return [...kept, ...incoming];
}
