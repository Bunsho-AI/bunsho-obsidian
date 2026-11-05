/**
 * What checks have read, kept in a file in the plugin's folder in the vault: the World tab and chapter checks use it, and it
 * stays with the writer's book, through sign-out too. Only the file's shape is trusted, so an old or hand-edited file reads as nothing rather than breaking the panel.
 */
import type { App } from "obsidian";
import { parseCastMembers, validChapterRead } from "@/lib/contract/pipelineV3Frames";
import type { KeptRead } from "@/helpers/reads";
import type { CastMember } from "@/lib/contract/pipelineV3.types";

export interface WorldData {
  /** The book as checks have read it. A read belongs to the page revision it was made from, which is what ties it to a review. */
  reads: KeptRead[];
  cast: CastMember[];
  /** A full review built the cast: a chapter check can then compare against the book. */
  fromFullReview: boolean;
}

const VERSION = 2;
const FILE = "world.json";
const pathIn = (dir: string): string => `${dir}/${FILE}`;

const keptRead = (value: unknown): value is KeptRead => {
  const entry = value as Partial<KeptRead> | null;
  return Boolean(entry) && (entry?.readPolicyId === null || typeof entry?.readPolicyId === "string") && validChapterRead(entry?.read);
};

export async function readWorld(app: App, dir: string): Promise<WorldData | null> {
  try {
    const path = pathIn(dir);
    if (!(await app.vault.adapter.exists(path))) return null;
    const raw = JSON.parse(await app.vault.adapter.read(path)) as { version?: unknown; reads?: unknown; cast?: unknown; fromFullReview?: unknown };
    const cast = parseCastMembers(raw.cast);
    if (!Array.isArray(raw.reads) || !cast) return null;
    // A file from before chapter checks says nothing of its read policy: its reads stay for the World and are never sent.
    if (raw.version === 1) return { reads: raw.reads.filter(validChapterRead).map((read) => ({ readPolicyId: null, read })), cast, fromFullReview: false };
    if (raw.version !== VERSION) return null;
    return { reads: raw.reads.filter(keptRead), cast, fromFullReview: raw.fromFullReview === true };
  } catch {
    return null;
  }
}

export async function writeWorld(app: App, dir: string, data: WorldData): Promise<void> {
  if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
  await app.vault.adapter.write(pathIn(dir), JSON.stringify({ version: VERSION, ...data }));
}

export async function removeWorld(app: App, dir: string): Promise<void> {
  const path = pathIn(dir);
  if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
}
