/**
 * What the writer declared, in canon.json in the plugin's folder, beside world.json (founder, 5 November 2026). Unlike world.json this
 * cannot be read again from the book, so nothing here ever replaces it with empty data: a file it cannot read, or can read only part
 * of, is copied to canon.broken.json first. A write goes through a temporary file, and a read finishes one a crash interrupted.
 */
import type { App } from "obsidian";
import { parseTracking, type CanonTracking } from "@/helpers/canon/record";
import type { SourceChoice } from "@/helpers/sources";

/** One book's record: a vault can hold two books, and one's facts must not be held against the other's prose. */
export interface CanonBook {
  source: SourceChoice;
  tracking: CanonTracking;
  /** The pins as last checked across the whole book: by a full review or Check canon. */
  checked: { pinDigest: string; checkedAt: string } | null;
}

const VERSION = 1;
const FILE = "canon.json";
const TEMPORARY = "canon.json.tmp";
export const BROKEN = "canon.broken.json";

export interface CanonRead { books: CanonBook[]; /** The file, or part of it, could not be read. Its copy is in canon.broken.json. */ damaged: boolean }

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function source(value: unknown): SourceChoice | null {
  return record(value) && (value.kind === "folder" || value.kind === "note") && typeof value.path === "string" ? value as unknown as SourceChoice : null;
}

async function keepCopy(app: App, dir: string, text: string): Promise<void> {
  const copy = `${dir}/${BROKEN}`;
  if (!(await app.vault.adapter.exists(copy))) await app.vault.adapter.write(copy, text);
}

export async function readCanon(app: App, dir: string): Promise<CanonRead> {
  const { adapter } = app.vault;
  const path = `${dir}/${FILE}`;
  const temporary = `${dir}/${TEMPORARY}`;
  const hasFile = await adapter.exists(path);
  const hasTemporary = await adapter.exists(temporary);
  if (!hasFile && !hasTemporary) return { books: [], damaged: false };
  // A crash between the two steps of a write leaves the new version in the temporary file.
  const text = await adapter.read(hasFile ? path : temporary);
  const damaged = async (): Promise<CanonRead> => { await keepCopy(app, dir, text); return { books: [], damaged: true }; };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return damaged(); }
  if (!record(raw) || raw.version !== VERSION || !Array.isArray(raw.books)) return damaged();
  let dropped = 0;
  const books: CanonBook[] = [];
  for (const entry of raw.books as unknown[]) {
    const place = record(entry) ? source(entry.source) : null;
    const parsed = record(entry) ? parseTracking(entry.tracking) : null;
    if (!place || !parsed) { dropped++; continue; }
    dropped += parsed.dropped;
    const checked = record(entry) && record(entry.checked) && typeof entry.checked.pinDigest === "string" && typeof entry.checked.checkedAt === "string"
      ? { pinDigest: entry.checked.pinDigest, checkedAt: entry.checked.checkedAt } : null;
    books.push({ source: place, tracking: parsed.tracking, checked });
  }
  if (dropped > 0) await keepCopy(app, dir, text);
  return { books, damaged: dropped > 0 };
}

export async function writeCanon(app: App, dir: string, books: readonly CanonBook[]): Promise<void> {
  const { adapter } = app.vault;
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  const path = `${dir}/${FILE}`;
  const temporary = `${dir}/${TEMPORARY}`;
  await adapter.write(temporary, JSON.stringify({ version: VERSION, books }));
  if (await adapter.exists(path)) await adapter.remove(path);
  await adapter.rename(temporary, path);
}

/** Only "Delete my Bunsho data" comes here. */
export async function removeCanon(app: App, dir: string): Promise<void> {
  const { adapter } = app.vault;
  for (const name of [FILE, TEMPORARY, BROKEN]) if (await adapter.exists(`${dir}/${name}`)) await adapter.remove(`${dir}/${name}`);
}
