/**
 * The Director's state and actions (the desktop's SceneCardService and its tab's flows). One direction makes one card; the writer fixes it by hand, free, regenerates it or one beat
 * (priced), writes the whole scene (priced per beat), rewrites one passage (priced), then keeps or discards. Only Keep reaches the page. Nothing here runs a check: it is offered after
 * Keep, and runs only when the writer asks.
 *
 * The engine is stateless: tracking and the scene travel with every request; the scene lives in the vault's Bunsho folder, what only this machine knows stripped before it travels.
 */
import { Notice, type App } from "obsidian";
import type { ContinuityController } from "@/controllers/ContinuityController";
import { cursorContext, planInsert, type PlacementMark } from "@/helpers/director/placement";
import { applyBeatEdits, applyDiscard, applyDraft, applyKept, applyRegenerated, applyRegeneratedBeat, applyRewrite, directionOf, isKept, keptInsertKey, newSceneRecord, rewriteContext, swapPrevious, toEngineSheet, type DirectorSceneRecord, type EditedBeat } from "@/helpers/director/sceneCard";
import { NO_CHAPTER, type DirectorChapterRef, type SceneOp } from "@/helpers/director/sceneView";
import { noteIdOf, type PlannedItem } from "@/helpers/sources";
import { PLAN_OP, RENDER_OP, type EnginePlanResponse } from "@/lib/contract/director.types";
import { placeInNote } from "@/lib/obsidian/keep";
import { noteCursor } from "@/lib/obsidian/editor";
import { listScenes, writeScene } from "@/lib/obsidian/sceneStore";
import { AuthError } from "@/lib/services/auth/authService";
import { DirectorEngine, REPLAY_UNAVAILABLE } from "@/lib/services/director/directorService";
import { EngineRequestError } from "@/lib/services/engine/engineService";

/** The engine reads the last few thousand characters, and refuses a request past its 50,000-character limit. */
export const PRECEDING_PROSE_CHARS = 20_000;
const AUTH_REQUIRED_MESSAGE = "Sign in to use AI features — your writing never needs an account.";

export type ScenePlacement = "append" | "cursor";
export type DirectorBusy = SceneOp | "keep" | "discard" | "swap" | null;
export interface SceneAnchorInput { itemId: string; placement: ScenePlacement }

export type SceneFailure =
  /** Nothing was sent: the writer can act on this. */
  | { kind: "input"; message: string }
  | { kind: "auth"; message: string }
  /** The engine said 402. Nothing was charged. */
  | { kind: "credits" }
  /** `charged` is the engine's own figure, null when it did not say. */
  | { kind: "failed"; charged: number | null; replayed?: boolean };
export type SceneResult = { ok: true; scene: DirectorSceneRecord } | { ok: false; failure: SceneFailure };
export type KeepResult = { ok: true; scene: DirectorSceneRecord; note: string | null } | { ok: false; message: string };

class SceneInputError extends Error {}

const noteField = (note: string | undefined): { note?: string } => { const trimmed = note?.trim(); return trimmed ? { note: trimmed } : {}; };
const recordOf = (response: EnginePlanResponse) => response.record.length > 0 ? response.record : response.scene.record ?? [];
const safeId = (sceneId: string): string => sceneId.toLowerCase().replace(/[^a-z0-9_-]/gu, "").slice(0, 180) || "sc_scene";
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : "That could not be done.");

export class DirectorController {
  scenes: DirectorSceneRecord[] = [];
  loaded = false;
  busy: DirectorBusy = null;
  regeneratingBeatId: string | null = null;
  rewritingBeat: number | null = null;
  private taken = new Set<string>();
  private loadedFrom: { dir: string; epoch: number } | null = null;
  private loading: Promise<void> | null = null;
  /** Scenes this session placed, by draft: a retried Keep records, and never places again. */
  private readonly placed = new Map<string, string>();
  private readonly engine: DirectorEngine;

  constructor(private readonly app: App, private readonly continuity: ContinuityController, private readonly changed: () => void) {
    this.engine = new DirectorEngine(() => continuity.connectionOptions());
  }

  /** Reads the scenes when the panel first needs them, and again when the data here changes hands. */
  ensureLoaded(): void {
    const dir = this.continuity.accountFolder();
    const epoch = this.continuity.dataEpoch;
    if (this.loadedFrom?.dir === dir && this.loadedFrom.epoch === epoch) return;
    if (this.loadedFrom) { this.scenes = []; this.taken = new Set(); this.placed.clear(); this.loaded = false; }
    this.loadedFrom = { dir, epoch };
    const read = listScenes(this.app, dir).then((list) => {
      if (this.loadedFrom?.dir !== dir || this.loadedFrom.epoch !== epoch) return;
      this.scenes = list.scenes;
      this.taken = new Set(list.taken);
      this.loaded = true;
      if (list.damaged > 0) new Notice(`Bunsho could not read ${list.damaged === 1 ? "one of your scenes" : `${list.damaged} of your scenes`}. The files were left as they are, in the scenes folder of the Bunsho folder in your vault.`);
      this.changed();
    }).catch((error: unknown) => {
      console.warn("[Bunsho] could not read the scenes", error);
      this.loaded = true;
      this.changed();
    }).finally(() => { this.loading = null; });
    this.loading = read;
  }

  /** Finished once the first read has. For tests and for what must not act on an empty list. */
  async whenLoaded(): Promise<void> { this.ensureLoaded(); await this.loading; }

  /** The scenes of the book picked now, newest first. A scene belongs to its note, and a note whose place is unknown stays visible: its draft may be the only copy. */
  visibleScenes(): DirectorSceneRecord[] {
    return this.scenes.filter((scene) => {
      const path = this.continuity.pathOfNote(noteIdOf(scene.anchor.pageId));
      return path === null || this.continuity.touchesSource(path);
    });
  }

  /** Every chapter by plan item and by page: a card names the first, a record line cites the second. */
  chapters(): Record<string, DirectorChapterRef> {
    const { scan } = this.continuity;
    if (scan.status !== "ready") return {};
    const out: Record<string, DirectorChapterRef> = {};
    scan.items.filter((item) => item.included).forEach((item, at) => { out[item.id] = { title: item.label, ordinal: at + 1 }; });
    for (const page of scan.pages) if (out[page.sourceId]) out[page.pageId] = out[page.sourceId];
    return out;
  }

  get planPrice(): number | null { return this.continuity.account.opCosts?.[PLAN_OP] ?? null; }
  get beatPrice(): number | null { return this.continuity.account.opCosts?.[RENDER_OP] ?? null; }

  private setBusy(kind: DirectorBusy): void { this.busy = kind; this.changed(); }

  private replace(scene: DirectorSceneRecord): void {
    const index = this.scenes.findIndex((s) => s.sceneId === scene.sceneId);
    this.scenes = index === -1 ? [scene, ...this.scenes] : this.scenes.map((s, i) => (i === index ? scene : s));
  }

  /** A paid answer shows even if the disk refuses it, until restart, and the writer is told. */
  private async keepScene(dir: string, scene: DirectorSceneRecord): Promise<void> {
    this.replace(scene);
    try { await this.continuity.trackSceneWrite(writeScene(this.app, dir, scene)); } catch (error) {
      console.warn("[Bunsho] could not save a scene", error);
      new Notice("Bunsho could not save this scene to disk. It stays in the panel until Obsidian closes.");
    }
  }

  private find(sceneId: string): DirectorSceneRecord {
    const scene = this.scenes.find((s) => s.sceneId === sceneId);
    if (!scene) throw new SceneInputError("That scene is no longer here.");
    return scene;
  }

  private unwritten(sceneId: string): DirectorSceneRecord {
    const scene = this.find(sceneId);
    if (isKept(scene)) throw new SceneInputError("This scene is already in the chapter.");
    if (scene.draft) throw new SceneInputError("Keep or discard the draft first.");
    return scene;
  }

  /** One action at a time: a second click cannot start a second charge. Answers that arrive after the data here changed hands go nowhere. */
  private async action(kind: Exclude<DirectorBusy, null>, run: (dir: string, live: () => boolean) => Promise<DirectorSceneRecord>): Promise<SceneResult> {
    if (this.busy) return { ok: false, failure: { kind: "input", message: "" } };
    const dir = this.continuity.accountFolder();
    const epoch = this.continuity.dataEpoch;
    this.setBusy(kind);
    try {
      const scene = await run(dir, () => this.continuity.dataEpoch === epoch);
      return { ok: true, scene };
    } catch (error) {
      return { ok: false, failure: await this.failureOf(error) };
    } finally {
      this.setBusy(null);
    }
  }

  private async failureOf(error: unknown): Promise<SceneFailure> {
    if (error instanceof SceneInputError) return { kind: "input", message: error.message };
    if (error instanceof AuthError) { if (error.code === "signed_out") await this.continuity.refreshAccount(); return { kind: "auth", message: AUTH_REQUIRED_MESSAGE }; }
    if (error instanceof EngineRequestError) {
      console.warn(`[Bunsho] Director engine call failed: ${error.status} ${error.code ?? ""}`);
      if (error.status === 402) return { kind: "credits" };
      if (error.status === 401) { await this.continuity.refreshAccount(); return { kind: "auth", message: AUTH_REQUIRED_MESSAGE }; }
      return { kind: "failed", charged: error.charged, ...(error.code === REPLAY_UNAVAILABLE ? { replayed: true } : {}) };
    }
    console.warn("[Bunsho] Director action failed", errorMessage(error));
    return { kind: "failed", charged: null };
  }

  /**
   * What every paid call needs: the tracking, the chapter's place in the book, and the prose the scene continues from. "At the cursor" is the cursor now, when that chapter's note is
   * open and the cursor is in it, and comes with the mark Keep returns to; otherwise the whole chapter, and Keep goes to its end, as on the desktop. Reads the notes fresh, and refuses
   * before anything is paid for.
   */
  private async context(anchor: SceneAnchorInput): Promise<{ pageId: string; pageOrder: number; precedingProse: string; mark?: PlacementMark; item: PlannedItem }> {
    let scan;
    try { scan = await this.continuity.readScan(); } catch { throw new SceneInputError("Bunsho couldn't read this chapter's file, so nothing was written and nothing was charged."); }
    const item = scan.status === "ready" ? scan.items.find((candidate) => candidate.id === anchor.itemId && candidate.included) : undefined;
    const pages = scan.status === "ready" ? scan.pages.filter((page) => page.sourceId === anchor.itemId) : [];
    if (!item || pages.length === 0) throw new SceneInputError(NO_CHAPTER);
    const last = pages[pages.length - 1];
    const whole = { pageId: last.pageId, pageOrder: last.order, precedingProse: item.text.slice(-PRECEDING_PROSE_CHARS), item };
    if (anchor.placement !== "cursor") return whole;
    const open = noteCursor(this.app, item.path);
    if (!open) return whole;
    const at = cursorContext(open.text, open.cursor, item.from, item.from + item.text.length);
    if (!at) return whole;
    const { mark, preceding } = at;
    const page = [...pages].reverse().find((candidate) => candidate.noteOffset <= mark.offset) ?? pages[0];
    return { pageId: page.pageId, pageOrder: page.order, precedingProse: preceding.slice(-PRECEDING_PROSE_CHARS), mark, item };
  }

  /** A new direction always starts a new card, in its own file. */
  plan(direction: string, anchor: SceneAnchorInput): Promise<SceneResult> {
    const text = direction.trim();
    return this.action("plan", async (dir, live) => {
      if (!text) throw new SceneInputError("Write a direction first.");
      const context = await this.context(anchor);
      const response = await this.engine.plan({ direction: text, targetPageId: context.pageId, pageOrder: context.pageOrder, precedingProse: context.precedingProse, tracking: this.continuity.directorTracking() });
      const scene = newSceneRecord({ ...response.scene, sceneId: safeId(response.scene.sceneId), anchor: { pageId: anchor.itemId, placement: anchor.placement } },
        { direction: text, record: recordOf(response), nowIso: new Date().toISOString(), takenIds: this.taken });
      this.taken.add(scene.sceneId);
      if (live()) await this.keepScene(dir, scene);
      void this.continuity.refreshAccount();
      return scene;
    });
  }

  /** Regenerate scene, with a note, or plan from an edited direction: the new card replaces this one, and this one becomes the previous card. `edits`: the card as the writer left it. */
  regenerate(input: { sceneId: string; note?: string; direction?: string; anchor: SceneAnchorInput; edits?: EditedBeat[] }): Promise<SceneResult> {
    return this.action("regenerate", async (dir, live) => {
      const current = this.edited(this.unwritten(input.sceneId), input.edits);
      if (input.edits) await this.keepScene(dir, current);
      const context = await this.context(input.anchor);
      const edited = input.direction?.trim();
      const response = await this.engine.plan({ direction: edited || directionOf(current), targetPageId: context.pageId, pageOrder: context.pageOrder, precedingProse: context.precedingProse, tracking: this.continuity.directorTracking(),
        ...(edited ? {} : { scene: toEngineSheet(current), regenerate: noteField(input.note) }) });
      const next = applyRegenerated({ ...current, anchor: { pageId: input.anchor.itemId, placement: input.anchor.placement } }, { ...response.scene, directorNotes: edited ? [edited] : current.directorNotes },
        { note: input.note, record: recordOf(response), ...(edited ? { direction: edited } : {}) });
      if (live()) await this.keepScene(dir, next);
      void this.continuity.refreshAccount();
      return next;
    });
  }

  regenerateBeat(input: { sceneId: string; beatId: string; note?: string; anchor: SceneAnchorInput; edits?: EditedBeat[] }): Promise<SceneResult> {
    return this.action("regenerateBeat", async (dir, live) => {
      this.regeneratingBeatId = input.beatId;
      try {
        const current = this.edited(this.unwritten(input.sceneId), input.edits);
        if (input.edits) await this.keepScene(dir, current);
        if (!current.beats.some((beat) => beat.beatId === input.beatId)) return current;
        const context = await this.context(input.anchor);
        const response = await this.engine.plan({ direction: directionOf(current), targetPageId: context.pageId, pageOrder: context.pageOrder, precedingProse: context.precedingProse, tracking: this.continuity.directorTracking(),
          scene: toEngineSheet(current), regenerateBeat: { beatId: input.beatId, ...noteField(input.note) } });
        const next = applyRegeneratedBeat(current, response.scene, input.beatId, recordOf(response));
        if (live()) await this.keepScene(dir, next);
        void this.continuity.refreshAccount();
        return next;
      } finally { this.regeneratingBeatId = null; }
    });
  }

  private edited(scene: DirectorSceneRecord, edits: readonly EditedBeat[] | undefined): DirectorSceneRecord {
    if (!edits) return scene;
    const next = applyBeatEdits(scene, edits);
    if (next.beats.length === 0) throw new SceneInputError("A scene needs at least one beat.");
    return next;
  }

  /** Hand edits: free, local, never an engine call. */
  editBeats(sceneId: string, beats: EditedBeat[]): Promise<SceneResult> {
    return this.action("swap", async (dir) => { const next = this.edited(this.unwritten(sceneId), beats); await this.keepScene(dir, next); return next; });
  }

  /** Write scene: the whole scene in one call, from the chapter as it stands or the text before the cursor. The mark is taken here, so Keep returns to the place it was written from. */
  write(input: { sceneId: string; anchor: SceneAnchorInput; edits?: EditedBeat[] }): Promise<SceneResult> {
    return this.action("write", async (dir, live) => {
      const current = this.edited(this.unwritten(input.sceneId), input.edits);
      if (input.edits) await this.keepScene(dir, current);
      const context = await this.context(input.anchor);
      const anchored: DirectorSceneRecord = { ...current, anchor: { pageId: input.anchor.itemId, placement: input.anchor.placement } };
      const written = await this.engine.renderScene({ scene: toEngineSheet(anchored), tracking: this.continuity.directorTracking(), precedingProse: context.precedingProse });
      const next = applyDraft(anchored, written, context.precedingProse, context.mark);
      if (live()) await this.keepScene(dir, next);
      void this.continuity.refreshAccount();
      return next;
    });
  }

  /** Rewrite this beat: one passage again, leading on from the passages before it and into the one after. */
  rewriteBeat(input: { sceneId: string; beatId: string; beatOrder: number; note?: string }): Promise<SceneResult> {
    return this.action("rewrite", async (dir, live) => {
      this.rewritingBeat = input.beatOrder;
      try {
        const current = this.find(input.sceneId);
        if (!current.draft || isKept(current)) throw new SceneInputError("There is no draft to rewrite.");
        const around = rewriteContext(current.draft, input.beatId, "");
        const note = input.note?.trim();
        const sheet = toEngineSheet(current);
        const response = await this.engine.renderBeat({
          scene: note ? { ...sheet, beats: sheet.beats.map((b) => (b.beatId === input.beatId ? { ...b, directions: [...b.directions, note] } : b)) } : sheet,
          beatId: input.beatId, tracking: this.continuity.directorTracking(), precedingProse: around.precedingProse.slice(-PRECEDING_PROSE_CHARS), ...(around.followingProse ? { followingProse: around.followingProse } : {}),
        });
        const next = applyRewrite(current, input.beatId, response.prose, note);
        if (live()) await this.keepScene(dir, next);
        void this.continuity.refreshAccount();
        return next;
      } finally { this.rewritingBeat = null; }
    });
  }

  /**
   * Keep: the first time the plugin writes into a manuscript. Placed at most once: one action at a time; this session remembers what it placed; and a note that already holds the
   * draft word for word is recorded and not written to, which covers a restart between the write and the record. The note decides where, as it is at that moment.
   */
  async keep(sceneId: string, title: (itemId: string) => string): Promise<KeepResult> {
    if (this.busy) return { ok: false, message: "" };
    const current = this.scenes.find((s) => s.sceneId === sceneId);
    if (!current?.draft || isKept(current)) return { ok: false, message: "" };
    const dir = this.continuity.accountFolder();
    const epoch = this.continuity.dataEpoch;
    const prose = current.draft.text;
    const itemId = current.anchor.pageId;
    const key = keptInsertKey(sceneId, prose);
    const chapter = title(itemId);
    this.setBusy("keep");
    try {
      let note: string | null = null;
      if (this.placed.get(sceneId) !== key) {
        const noteId = noteIdOf(itemId);
        const path = this.continuity.pathOfNote(noteId);
        const { source } = this.continuity.data;
        if (!path || !source) return { ok: false, message: `${chapter} is no longer in your vault. Nothing was placed.` };
        const basename = path.split("/").pop()?.replace(/\.md$/u, "") ?? path;
        const result = await placeInNote(this.app, path, (raw) => planInsert({ raw, note: { noteId, path, basename }, source, itemId, placement: current.anchor.placement, mark: current.mark, prose }));
        if (result.kind === "missing") return { ok: false, message: `${chapter} is no longer in your vault. Nothing was placed.` };
        this.placed.set(sceneId, key);
        if (result.kind === "placed") {
          const notes: string[] = [];
          if (result.plan.noteEnd) notes.push(`${chapter} has changed in your plan since this scene was written, so it went at the end of that note.`);
          else if (current.anchor.placement === "cursor" && result.plan.at === "end") notes.push(`The chapter was reopened since this scene was written, so it went at the end of ${chapter}.`);
          if (!result.undoable) notes.push(`${chapter} wasn't open for editing, so this went straight into the file, and Undo cannot take it back.`);
          note = notes.length > 0 ? notes.join(" ") : null;
        }
      }
      try {
        const next = applyKept(current, itemId, new Date().toISOString());
        // Deleted while it was being placed: what is in the note is the writer's, and there is nothing left to record it in.
        if (this.continuity.dataEpoch !== epoch) return { ok: true, scene: next, note };
        await this.continuity.trackSceneWrite(writeScene(this.app, dir, next));
        this.replace(next);
        // The check is offered once, for the scene just kept: an older, unanswered offer is let go. Best effort: the scene is kept by now.
        for (const other of this.scenes) {
          if (other.sceneId !== next.sceneId && other.checkOffer) await this.keepScene(dir, { ...other, checkOffer: false });
        }
        await this.continuity.refreshScan();
        return { ok: true, scene: next, note };
      } catch (error) {
        return { ok: false, message: `The scene is in ${chapter}, but Bunsho could not note that: ${errorMessage(error)}` };
      }
    } catch (error) {
      console.warn("[Bunsho] Keep failed", error);
      return { ok: false, message: `${chapter} could not be changed. Nothing was placed.` };
    } finally {
      this.setBusy(null);
    }
  }

  discard(sceneId: string): Promise<SceneResult> {
    return this.action("discard", async (dir) => {
      const current = this.find(sceneId);
      if (isKept(current)) throw new SceneInputError("This scene is already in the chapter.");
      const next = applyDiscard(current);
      await this.keepScene(dir, next);
      return next;
    });
  }

  swapPrevious(sceneId: string, edits?: EditedBeat[]): Promise<SceneResult> {
    return this.action("swap", async (dir) => { const next = swapPrevious(this.edited(this.unwritten(sceneId), edits)); await this.keepScene(dir, next); return next; });
  }

  async dismissCheckOffer(sceneId: string): Promise<void> {
    const current = this.scenes.find((s) => s.sceneId === sceneId);
    if (current) await this.keepScene(this.continuity.accountFolder(), { ...current, checkOffer: false });
    this.changed();
  }
}
