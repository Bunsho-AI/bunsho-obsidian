/**
 * What the last check read, kept in a file in the plugin's folder in the vault: the World tab's data stays with the writer's
 * book. Only the file's shape is trusted, so an old or hand-edited file reads as nothing rather than breaking the panel.
 */
import type { App } from "obsidian";
import { validChapterRead } from "@/lib/contract/pipelineV3Frames";
import type { CastMember, ChapterRead } from "@/lib/contract/pipelineV3.types";

export interface WorldData {
  /** The review these reads belong to. */
  snapshotId: string;
  reads: ChapterRead[];
  cast: CastMember[];
}

const VERSION = 1;
const FILE = "world.json";
const pathIn = (dir: string): string => `${dir}/${FILE}`;

export async function readWorld(app: App, dir: string): Promise<WorldData | null> {
  try {
    const path = pathIn(dir);
    if (!(await app.vault.adapter.exists(path))) return null;
    const raw = JSON.parse(await app.vault.adapter.read(path)) as Partial<WorldData> & { version?: unknown };
    if (raw.version !== VERSION || typeof raw.snapshotId !== "string" || !Array.isArray(raw.reads) || !Array.isArray(raw.cast)) return null;
    return { snapshotId: raw.snapshotId, reads: raw.reads.filter(validChapterRead), cast: raw.cast };
  } catch {
    return null;
  }
}

export async function writeWorld(app: App, dir: string, data: WorldData): Promise<void> {
  await app.vault.adapter.write(pathIn(dir), JSON.stringify({ version: VERSION, ...data }));
}

export async function removeWorld(app: App, dir: string): Promise<void> {
  const path = pathIn(dir);
  if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
}
