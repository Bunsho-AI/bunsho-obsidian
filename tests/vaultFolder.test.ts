/** Canon and scenes in the vault: which folder names are trusted, how a rename moves it, and the one-time move from the plugin's folder. */
import { describe, expect, it } from "vitest";
import { DATA_FOLDER, dataFolderOf, followFolder, moveToVault, removeIfEmpty } from "@/lib/obsidian/vaultFolder";

const KEY = "a".repeat(24);

/** A disk with real folders: list returns direct children only, and rmdir refuses a folder that is not empty unless asked. */
function disk(files: Record<string, string>) {
  const stored = new Map(Object.entries(files));
  const dirs = new Set<string>();
  const parentsOf = (path: string) => path.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));
  for (const path of stored.keys()) for (const dir of parentsOf(path)) dirs.add(dir);
  const children = (dir: string) => ({
    files: [...stored.keys()].filter((key) => key.startsWith(`${dir}/`) && !key.slice(dir.length + 1).includes("/")),
    folders: [...dirs].filter((key) => key.startsWith(`${dir}/`) && !key.slice(dir.length + 1).includes("/")),
  });
  const adapter = {
    exists: (path: string) => Promise.resolve(stored.has(path) || dirs.has(path)),
    read: (path: string) => (stored.has(path) ? Promise.resolve(stored.get(path)!) : Promise.reject(new Error(`no ${path}`))),
    write: (path: string, text: string) => { stored.set(path, text); for (const dir of parentsOf(path)) dirs.add(dir); return Promise.resolve(); },
    remove: (path: string) => { stored.delete(path); return Promise.resolve(); },
    mkdir: (path: string) => { dirs.add(path); return Promise.resolve(); },
    list: (dir: string) => Promise.resolve(children(dir)),
    rmdir: (dir: string, recursive: boolean) => {
      const inside = children(dir);
      if (!recursive && (inside.files.length > 0 || inside.folders.length > 0)) return Promise.reject(new Error("not empty"));
      for (const key of [...stored.keys()]) if (key.startsWith(`${dir}/`)) stored.delete(key);
      for (const key of [...dirs]) if (key === dir || key.startsWith(`${dir}/`)) dirs.delete(key);
      return Promise.resolve();
    },
  };
  return { app: { vault: { adapter } } as never, adapter, stored, dirs };
}

describe("the folder data.json names", () => {
  it("is the default when missing or not a string", () => {
    expect(dataFolderOf(undefined, ".obsidian")).toBe(DATA_FOLDER);
    expect(dataFolderOf(3, ".obsidian")).toBe(DATA_FOLDER);
    expect(dataFolderOf("", ".obsidian")).toBe(DATA_FOLDER);
  });

  it("keeps a folder the writer moved it to, tidied", () => {
    expect(dataFolderOf("Writing/Bunsho", ".obsidian")).toBe("Writing/Bunsho");
    expect(dataFolderOf("/Writing//Bunsho/", ".obsidian")).toBe("Writing/Bunsho");
    expect(dataFolderOf("Écrits/本書", ".obsidian")).toBe("Écrits/本書");
  });

  it("never leaves the vault or reaches Obsidian's own folders", () => {
    for (const bad of ["../elsewhere", "a/../../b", ".obsidian", ".obsidian/plugins/bunsho", ".hidden", "a/./b", "My Config/x"]) {
      expect(dataFolderOf(bad, bad === "My Config/x" ? "My Config" : ".obsidian")).toBe(DATA_FOLDER);
    }
  });
});

describe("a rename in the vault", () => {
  it("moves the folder with it, and leaves it alone otherwise", () => {
    expect(followFolder("Bunsho", "Notes/Bunsho", "Bunsho")).toBe("Notes/Bunsho");
    expect(followFolder("Writing/Bunsho", "Drafts", "Writing")).toBe("Drafts/Bunsho");
    expect(followFolder("Bunsho", "Bunsho2", "Bunsho2-old")).toBe("Bunsho");
    expect(followFolder("Bunsho", "X", "Bun")).toBe("Bunsho");
  });
});

describe("the move from the plugin's folder", () => {
  const plugin = ".obsidian/plugins/bunsho";

  it("moves canon, its copies and scenes, for every account, and leaves the World and data.json", async () => {
    const { app, stored } = disk({
      [`${plugin}/data.json`]: "{}", [`${plugin}/world.json`]: "w",
      [`${plugin}/canon.json`]: "c", [`${plugin}/canon.broken.json`]: "b",
      [`${plugin}/scenes/sc_1.json`]: "s1", [`${plugin}/scenes/sc_1.json.bak`]: "s0",
      [`${plugin}/accounts/${KEY}/canon.json`]: "c2", [`${plugin}/accounts/${KEY}/world.json`]: "w2", [`${plugin}/accounts/${KEY}/scenes/sc_2.json`]: "s2",
      [`${plugin}/accounts/not-a-key/canon.json`]: "x",
    });
    expect(await moveToVault(app, plugin, "Bunsho")).toEqual({ moved: 6, kept: 0 });
    expect(Object.fromEntries([...stored].filter(([k]) => k.startsWith("Bunsho/")))).toEqual({
      "Bunsho/canon.json": "c", "Bunsho/canon.broken.json": "b", "Bunsho/scenes/sc_1.json": "s1", "Bunsho/scenes/sc_1.json.bak": "s0",
      [`Bunsho/accounts/${KEY}/canon.json`]: "c2", [`Bunsho/accounts/${KEY}/scenes/sc_2.json`]: "s2",
    });
    expect([...stored.keys()].filter((k) => k.startsWith(plugin)).sort()).toEqual(
      [`${plugin}/accounts/${KEY}/world.json`, `${plugin}/accounts/not-a-key/canon.json`, `${plugin}/data.json`, `${plugin}/world.json`]);
  });

  it("does nothing the second time, or when there is nothing to move", async () => {
    const { app } = disk({ [`${plugin}/canon.json`]: "c" });
    await moveToVault(app, plugin, "Bunsho");
    expect(await moveToVault(app, plugin, "Bunsho")).toEqual({ moved: 0, kept: 0 });
    expect(await moveToVault(disk({}).app, plugin, "Bunsho")).toEqual({ moved: 0, kept: 0 });
  });

  it("never writes over a file already in the vault: different text stays where it was, the same text is tidied away", async () => {
    const { app, stored } = disk({
      [`${plugin}/canon.json`]: "old", "Bunsho/canon.json": "newer",
      [`${plugin}/scenes/sc_1.json`]: "same", "Bunsho/scenes/sc_1.json": "same",
    });
    expect(await moveToVault(app, plugin, "Bunsho")).toEqual({ moved: 0, kept: 1 });
    expect(stored.get("Bunsho/canon.json")).toBe("newer");
    expect(stored.get(`${plugin}/canon.json`)).toBe("old");
    expect(stored.has(`${plugin}/scenes/sc_1.json`)).toBe(false);
  });

  it("keeps the original when the copy does not read back the same", async () => {
    const { app, adapter, stored } = disk({ [`${plugin}/canon.json`]: "c" });
    const write = adapter.write;
    adapter.write = (p, t) => write(p, `${t}-torn`);
    await expect(moveToVault(app, plugin, "Bunsho")).rejects.toThrow();
    expect(stored.get(`${plugin}/canon.json`)).toBe("c");
  });
});

describe("after Delete my Bunsho data", () => {
  it("removes the folder when nothing else is in it, and keeps it when the writer put something there", async () => {
    const empty = disk({});
    for (const dir of ["Bunsho", "Bunsho/accounts", `Bunsho/accounts/${KEY}`]) await empty.adapter.mkdir(dir);
    await removeIfEmpty(empty.app, "Bunsho");
    expect(empty.dirs.has("Bunsho")).toBe(false);

    const used = disk({ "Bunsho/my note.md": "mine" });
    await removeIfEmpty(used.app, "Bunsho");
    expect(used.stored.get("Bunsho/my note.md")).toBe("mine");
  });
});
