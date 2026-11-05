/**
 * One JSON per scene, under the account's folder in the plugin's folder (founder, 5 November 2026). A scene is authored work, so a write goes through a temporary file and keeps
 * one copy of what it replaces; a read finishes a write a crash interrupted. A file that cannot be read is left as it is, and its name stays taken, so nothing is written over it.
 */
import type { App } from "obsidian";
import { parseSceneRecord, type DirectorSceneRecord } from "@/helpers/director/sceneCard";

const FOLDER = "scenes";
/** Letters, digits, `_` and `-`: a scene id names a file and must never reach outside this folder. */
export const SCENE_ID = /^[A-Za-z0-9_-]{1,200}$/u;

export interface SceneList {
  scenes: DirectorSceneRecord[];
  /** Every name in use, the damaged ones included. */
  taken: string[];
  damaged: number;
}

const folder = (dir: string): string => `${dir}/${FOLDER}`;
const nameOf = (path: string): string => path.split("/").pop() ?? "";

function pathFor(dir: string, sceneId: string): string {
  if (!SCENE_ID.test(sceneId)) throw new Error(`Invalid scene id "${sceneId}"`);
  return `${folder(dir)}/${sceneId}.json`;
}

const parse = (text: string): DirectorSceneRecord | null => { try { return parseSceneRecord(JSON.parse(text) as unknown); } catch { return null; } };

/** Newest first. */
export async function listScenes(app: App, dir: string): Promise<SceneList> {
  const { adapter } = app.vault;
  if (!(await adapter.exists(folder(dir)))) return { scenes: [], taken: [], damaged: 0 };
  const { files } = await adapter.list(folder(dir));
  const names = new Set(files.map(nameOf));
  const taken = new Set<string>();
  const scenes: DirectorSceneRecord[] = [];
  let damaged = 0;
  for (const path of files) {
    const name = nameOf(path);
    const interrupted = name.endsWith(".json.tmp") && !names.has(name.slice(0, -4));
    if (!name.endsWith(".json") && !interrupted) continue;
    const id = name.replace(/\.json(\.tmp)?$/u, "");
    taken.add(id);
    let scene: DirectorSceneRecord | null = null;
    try { scene = parse(await adapter.read(path)); } catch (error) { console.warn(`[Bunsho] could not read the scene ${id}`, error); }
    if (scene && scene.sceneId === id) scenes.push(scene); else damaged++;
  }
  scenes.sort((a, b) => (b.createdAtIso ?? b.sceneId).localeCompare(a.createdAtIso ?? a.sceneId));
  return { scenes, taken: [...taken], damaged };
}

export async function writeScene(app: App, dir: string, scene: DirectorSceneRecord): Promise<void> {
  const { adapter } = app.vault;
  const target = pathFor(dir, scene.sceneId);
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  if (!(await adapter.exists(folder(dir)))) await adapter.mkdir(folder(dir));
  const temporary = `${target}.tmp`;
  await adapter.write(temporary, JSON.stringify(scene, null, 2));
  if (await adapter.exists(target)) {
    await adapter.write(`${target}.bak`, await adapter.read(target));
    await adapter.remove(target);
  }
  await adapter.rename(temporary, target);
}

/** Only "Delete my Bunsho data" comes here. */
export async function removeScenes(app: App, dir: string): Promise<void> {
  if (await app.vault.adapter.exists(folder(dir))) await app.vault.adapter.rmdir(folder(dir), true);
}
