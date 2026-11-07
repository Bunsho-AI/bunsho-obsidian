/**
 * Canon and Director scenes are the writer's own work, so they live in a folder of the vault, not the plugin's folder: Obsidian deletes
 * the plugin's folder on uninstall (founder, 6 November 2026: "Yes, use the vault"). They were first kept in the plugin's folder, so a
 * start moves what is there. A move never writes over a file already in the vault: a name that is taken with different text is left
 * where it was, and the writer is told.
 */
import type { App } from "obsidian";

export const DATA_FOLDER = "Bunsho";

/** Canon's files and their copies, in a folder of their own (canonStore.ts). */
const CANON_FILE = /^canon(\.broken(-\d+)?)?\.json(\.tmp)?$/u;
const SCENES = "scenes";
const ACCOUNTS = "accounts";
const ACCOUNT_KEY = /^[0-9a-f]{24}$/u;

/**
 * The folder data.json names, when it is one we can trust: synced or hand-edited, it must stay inside the vault and out of
 * Obsidian's own folders. Anything else is the default.
 */
export function dataFolderOf(value: unknown, configDir: string): string {
  if (typeof value !== "string") return DATA_FOLDER;
  const path = value.replace(/\\/gu, "/").replace(/\/+/gu, "/").replace(/^\/|\/$/gu, "").trim();
  const parts = path.split("/");
  if (!path || parts.some((part) => part === "" || part === "." || part === ".." || part.startsWith("."))) return DATA_FOLDER;
  if (path === configDir || path.startsWith(`${configDir}/`)) return DATA_FOLDER;
  return path;
}

/** A rename in the vault moves the folder: where it is now, or the same folder when the rename did not touch it. */
export function followFolder(folder: string, path: string, oldPath: string): string {
  if (folder === oldPath) return path;
  return folder.startsWith(`${oldPath}/`) ? `${path}${folder.slice(oldPath.length)}` : folder;
}

export interface MoveResult {
  moved: number;
  /** Files left in the plugin's folder because the vault already held different text under the name. */
  kept: number;
}

const nameOf = (path: string): string => path.split("/").pop() ?? "";

async function mkdirs(app: App, path: string): Promise<void> {
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const dir = parts.slice(0, i).join("/");
    if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
  }
}

/** One file. Written, read back, and only then removed from where it was. */
async function moveFile(app: App, from: string, to: string, result: MoveResult): Promise<void> {
  const { adapter } = app.vault;
  const text = await adapter.read(from);
  if (await adapter.exists(to)) {
    if ((await adapter.read(to)) === text) await adapter.remove(from);
    else result.kept++;
    return;
  }
  await mkdirs(app, to.split("/").slice(0, -1).join("/"));
  await adapter.write(to, text);
  if ((await adapter.read(to)) !== text) throw new Error(`Bunsho could not copy ${from}`);
  await adapter.remove(from);
  result.moved++;
}

async function moveOne(app: App, from: string, to: string, result: MoveResult): Promise<void> {
  const { adapter } = app.vault;
  if (!(await adapter.exists(from))) return;
  const { files } = await adapter.list(from);
  for (const path of files) if (CANON_FILE.test(nameOf(path))) await moveFile(app, path, `${to}/${nameOf(path)}`, result);
  const scenes = `${from}/${SCENES}`;
  if (!(await adapter.exists(scenes))) return;
  for (const path of (await adapter.list(scenes)).files) await moveFile(app, path, `${to}/${SCENES}/${nameOf(path)}`, result);
  if ((await adapter.list(scenes)).files.length === 0) await adapter.rmdir(scenes, false);
}

/** Canon and scenes of every account, from the plugin's folder to the vault folder. */
export async function moveToVault(app: App, pluginDir: string, folder: string): Promise<MoveResult> {
  const result: MoveResult = { moved: 0, kept: 0 };
  await moveOne(app, pluginDir, folder, result);
  const accounts = `${pluginDir}/${ACCOUNTS}`;
  if (!(await app.vault.adapter.exists(accounts))) return result;
  for (const dir of (await app.vault.adapter.list(accounts)).folders) {
    const key = nameOf(dir);
    if (ACCOUNT_KEY.test(key)) await moveOne(app, dir, `${folder}/${ACCOUNTS}/${key}`, result);
  }
  return result;
}

/** "Delete my Bunsho data" took everything out: the folder goes too, unless the writer put something else in it. */
export async function removeIfEmpty(app: App, folder: string): Promise<void> {
  const { adapter } = app.vault;
  if (!(await adapter.exists(folder))) return;
  const accounts = `${folder}/${ACCOUNTS}`;
  if (await adapter.exists(accounts)) {
    const inside = await adapter.list(accounts);
    for (const dir of inside.folders) {
      const listed = await adapter.list(dir);
      if (listed.files.length === 0 && listed.folders.length === 0) await adapter.rmdir(dir, false);
    }
    const left = await adapter.list(accounts);
    if (left.files.length === 0 && left.folders.length === 0) await adapter.rmdir(accounts, false);
  }
  const listed = await adapter.list(folder);
  if (listed.files.length === 0 && listed.folders.length === 0) await adapter.rmdir(folder, false);
}
