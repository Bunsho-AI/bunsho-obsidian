/**
 * Pure view logic for the Director tab (the desktop's sceneView.ts and mention.ts): which card is on show, what each row says, the draft's passages, the record
 * lines' chapter, the example direction, the desktop's words.
 */
import type { DirectorCastMember } from "@/helpers/director/cast";
import { isKept, type DirectorSceneRecord, type SceneDraft } from "@/helpers/director/sceneCard";
import type { EngineBeat, EngineSceneRecordLine } from "@/lib/contract/director.types";

export interface DirectorChapterRef { title: string; ordinal: number }
export interface DraftPassage { beatId: string; beatOrder: number; paragraphs: string[] }
export type SceneRowStatus = "kept" | "unwritten" | "drafted";

/** The price as a button says it. Null when it is not known. */
export function price(amount: number | null | undefined): string | null {
  return amount == null ? null : `~${Math.max(0, Math.round(amount)).toLocaleString("en-US")}`;
}

export const FAILED_COPY = {
  plan: "The scene could not be planned. The fault was ours.",
  regenerate: "The scene could not be regenerated. The fault was ours.",
  regenerateBeat: "The beat could not be regenerated. The fault was ours.",
  write: "The scene could not be written. The fault was ours.",
  rewrite: "The beat could not be rewritten. The fault was ours.",
} as const;
export type SceneOp = keyof typeof FAILED_COPY;

export const NOTE_SLOT_COPY = {
  scene: { title: "Regenerate the whole scene", action: "Regenerate", hint: "A new card replaces this one. This one stays one click away until the scene is written." },
  beat: { title: "Regenerate this beat", action: "Regenerate", hint: null },
  rewrite: { title: "Rewrite this beat", action: "Rewrite", hint: null },
} as const;
export type NoteSlotKind = keyof typeof NOTE_SLOT_COPY;

export const STATUS_WORDS: Record<SceneRowStatus, string> = { kept: "kept", unwritten: "not written", drafted: "not kept" };
export const NO_CHAPTER = "Open a chapter first: the scene goes into the chapter you are in.";
export const QUILL_AI_UPSELL = {
  label: "Storyteller needed",
  body: "Quill covers the editor, World and Planner. Continuity checks and the Director come with Storyteller.",
  action: "Upgrade to Storyteller",
} as const;

/** The @-token being typed at the caret, or null when no mention is active. */
export function activeMention(text: string, caret: number): { query: string; start: number } | null {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/u.test(upToCaret[at - 1])) return null;
  const query = upToCaret.slice(at + 1);
  if (/[.,;:!?@\n]/u.test(query) || query.length > 24) return null;
  return { query, start: at };
}

/** Who the @ list offers for what is typed, as the desktop filters it. */
export function mentionMatches(cast: readonly DirectorCastMember[], query: string): DirectorCastMember[] {
  const q = query.trim().toLowerCase();
  return cast.filter((m) => q.length === 0 || m.name.toLowerCase().includes(q) || m.aliases.some((alias) => alias.toLowerCase().includes(q))).slice(0, 8);
}

/** The engine writes a scene of at most this many beats in one call (bunsho-engine MAX_RENDER_SCENE_BEATS). */
export const MAX_SCENE_BEATS = 12;

export const isKeptScene = isKept;

export function rowStatus(scene: DirectorSceneRecord): SceneRowStatus {
  if (isKeptScene(scene)) return "kept";
  return scene.draft ? "drafted" : "unwritten";
}

export function titleOf(scene: DirectorSceneRecord): string {
  return scene.title?.trim() || scene.goal.trim() || "Untitled scene";
}

export function descriptionOf(scene: DirectorSceneRecord): string {
  return scene.description?.trim() || scene.goal.trim();
}

/** The chapter a scene belongs to: where it was kept, else its anchor. */
export function scenePageId(scene: DirectorSceneRecord): string {
  return scene.kept?.pageId ?? scene.anchor.pageId;
}

export interface SceneLayout {
  /** The card on show: the one the writer reopened, else the newest scene while it is not yet kept. */
  current: DirectorSceneRecord | null;
  /** The just-kept scene still offering its check, framed under the direction box. */
  justKept: DirectorSceneRecord | null;
  /** Everything else, newest first. */
  earlier: DirectorSceneRecord[];
}

/**
 * What the tab shows (scenes arrive newest first, the store's order). `focus`: a scene the writer reopened, "none"
 * after they folded the card away (the empty box, ready for a new direction), or null for the default: the newest
 * scene, only while it is unkept. After Keep the box opens empty; an older unwritten scene stays in the list rather
 * than jumping onto the card.
 */
export function layoutScenes(scenes: readonly DirectorSceneRecord[], focus: string | "none" | null): SceneLayout {
  const opened = focus && focus !== "none" ? (scenes.find((s) => s.sceneId === focus) ?? null) : null;
  const newest = scenes[0];
  const current = opened ?? (focus === null && newest && !isKeptScene(newest) ? newest : null);
  const justKept =
    scenes.find((s) => s !== current && isKeptScene(s) && s.checkOffer === true) ?? null;
  const earlier = scenes.filter((s) => s !== current && s !== justKept);
  return { current, justKept, earlier };
}

export function passagesOf(draft: SceneDraft): DraftPassage[] {
  return draft.spans.map((span) => ({
    beatId: span.beatId,
    beatOrder: span.beatOrder,
    paragraphs: draft.text
      .slice(span.start, span.end)
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean),
  }));
}

/** The one sentence under a beat: what it changes, in the planner's story language. */
export function changeLine(beat: EngineBeat): string | undefined {
  return beat.turn?.trim() || undefined;
}

/** Beats a record line names: their numbers take --danger at 700. */
export function flaggedBeats(record: readonly EngineSceneRecordLine[] | undefined): Set<number> {
  const flagged = new Set<number>();
  for (const line of record ?? []) if (line.beatOrder != null) flagged.add(line.beatOrder);
  return flagged;
}

/** Canon first (rank 1), then what was found. */
export function rankedRecord(record: readonly EngineSceneRecordLine[] | undefined): EngineSceneRecordLine[] {
  return [...(record ?? [])].sort((a, b) => (a.rank === b.rank ? 0 : a.rank === "canon" ? -1 : 1));
}

/** The record line's closing sentence names the chapter the fact comes from, when the record places it. */
export function recordChapterSentence(
  line: EngineSceneRecordLine,
  chapters: Record<string, DirectorChapterRef>,
): string | null {
  const chapter = line.pageId ? chapters[line.pageId] : undefined;
  if (!chapter) return line.rank === "canon" ? "Pinned in the World." : null;
  return line.rank === "canon" ? `Pinned in ${chapter.title}.` : `Read in ${chapter.title}.`;
}

/**
 * The empty box's example, written with the book's own cast (22-DIRECTOR §4a). It shows the shape of a direction
 * (who, what happens, what changes) without proposing a plot beyond the two names.
 */
export function exampleDirection(cast: readonly DirectorCastMember[], afterKept: boolean): string {
  if (afterKept) return "Direct the next scene";
  const [first, second] = cast.filter((m) => m.tier === "main").concat(cast.filter((m) => m.tier !== "main"));
  if (first && second) return `${first.name} finally tells ${second.name} the truth. ${second.name} does not take it well.`;
  if (first) return `${first.name} comes back to the house and finds it changed.`;
  return "Say what happens in the scene and who is there.";
}

/** While writing, the pulse walks the beats in turn, paced to the expected length of the call. */
export function writingStepMs(beatCount: number): number {
  const expectedMs = 8_000 + beatCount * 6_000;
  return Math.max(2_500, Math.round(expectedMs / Math.max(1, beatCount)));
}
