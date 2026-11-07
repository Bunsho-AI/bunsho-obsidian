/**
 * The scene card (the desktop's sceneCard.ts, change them together): one direction, one card, one draft.
 *
 * A stored scene is the engine's beat sheet plus what only this machine knows: the writer's direction, the one
 * previous card a regeneration keeps, the whole-scene draft waiting in the panel, and what became of it. Every
 * transition here is pure so the service stays a thin read → transition → write, and the rules (Discard truly
 * discards, one previous card until written, hand edits are free and drop stale effects) are testable on their own.
 */
import { countWords as wordsOf } from "@/lib/contract/countWords";
import { parseBeatSheet, validBeat, validSpans, type EngineBeat, type EngineBeatSheet, type EngineRenderSceneResponse, type EngineSceneRecordLine } from "@/lib/contract/director.types";
import { sha256 } from "@/utils/hash";
import type { PlacementMark } from "@/helpers/director/placement";

export interface SceneDraftSpan {
  beatId: string;
  beatOrder: number;
  start: number;
  end: number;
}

/** The whole scene as written, in the panel, before Keep. Read-only to the writer. */
export interface SceneDraft {
  text: string;
  wordCount: number;
  spans: SceneDraftSpan[];
  /** The prose the scene was written to continue from (its tail): a rewrite leads on from the same place. */
  precedingTail?: string;
}

/** The card fields a regeneration swaps out; the one earlier card is kept as this until the scene is written. */
export interface SceneCardSnapshot {
  title?: string;
  description?: string;
  goal: string;
  beats: EngineBeat[];
  record?: EngineSceneRecordLine[];
  note?: string;
}

export interface SceneKept {
  pageId: string;
  keptAtIso: string;
}

export interface DirectorSceneRecord extends EngineBeatSheet {
  /** The writer's direction, verbatim (the settled well). Older scenes carry it only in directorNotes. */
  direction?: string;
  /** The regenerate note that produced this card ("Your note: …"). */
  note?: string;
  /** Exactly one earlier card, until the scene is written. */
  previous?: SceneCardSnapshot;
  /** True while the card on show is the OLDER one, so the control reads "Newer card". */
  showingPrevious?: boolean;
  draft?: SceneDraft;
  kept?: SceneKept;
  /** The one-time "Check this chapter" offer after Keep. */
  checkOffer?: boolean;
  /** The place "at the cursor" meant when the scene was written. */
  mark?: PlacementMark;
}

/** Fields the engine never sees: stripped before a scene travels in a request. */
const DESKTOP_ONLY_KEYS = [
  "direction",
  "note",
  "previous",
  "showingPrevious",
  "draft",
  "kept",
  "checkOffer",
  "mark",
] as const satisfies ReadonlyArray<keyof DirectorSceneRecord>;

export function toEngineSheet(scene: DirectorSceneRecord): EngineBeatSheet {
  const sheet: Record<string, unknown> = { ...scene };
  for (const key of DESKTOP_ONLY_KEYS) delete sheet[key];
  return sheet as unknown as EngineBeatSheet;
}

/** The direction the card was planned from: the stored one, else the first note an older scene kept. */
export function directionOf(scene: DirectorSceneRecord): string {
  return scene.direction ?? scene.directorNotes[0] ?? "";
}

/** A kept scene. Scenes from the per-beat flow count as kept once any beat reached the page. */
export function isKept(scene: DirectorSceneRecord): boolean {
  return Boolean(scene.kept) || scene.beats.some((b) => b.status === "accepted");
}

export function isWritten(scene: DirectorSceneRecord): boolean {
  return Boolean(scene.draft) || isKept(scene);
}

/** A newly planned card. The engine's sceneId is only a slug; `takenIds` keeps two scenes from sharing a file. */
export function newSceneRecord(
  planned: EngineBeatSheet,
  input: { direction: string; record?: EngineSceneRecordLine[]; nowIso: string; takenIds: ReadonlySet<string> },
): DirectorSceneRecord {
  return {
    ...planned,
    sceneId: uniqueSceneId(planned.sceneId, input.takenIds),
    direction: input.direction,
    record: input.record ?? planned.record ?? [],
    createdAtIso: input.nowIso,
  };
}

export function uniqueSceneId(wanted: string, taken: ReadonlySet<string>): string {
  const base = wanted.trim() || "sc_scene";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function snapshotOf(scene: DirectorSceneRecord): SceneCardSnapshot {
  return {
    ...(scene.title !== undefined ? { title: scene.title } : {}),
    ...(scene.description !== undefined ? { description: scene.description } : {}),
    goal: scene.goal,
    beats: scene.beats,
    ...(scene.record !== undefined ? { record: scene.record } : {}),
    ...(scene.note !== undefined ? { note: scene.note } : {}),
  };
}

function withSnapshot(scene: DirectorSceneRecord, snapshot: SceneCardSnapshot): DirectorSceneRecord {
  const next: DirectorSceneRecord = { ...scene, goal: snapshot.goal, beats: snapshot.beats };
  for (const key of ["title", "description", "record", "note"] as const) {
    if (snapshot[key] === undefined) delete next[key];
    else (next as unknown as Record<string, unknown>)[key] = snapshot[key];
  }
  return next;
}

/**
 * A regenerated card (Regenerate scene, or planning from an edited direction) replaces the one on show in place.
 * The replaced card becomes the previous one; a third plan replaces the oldest. Hand edits go with the replaced card.
 */
export function applyRegenerated(
  current: DirectorSceneRecord,
  planned: EngineBeatSheet,
  input: { note?: string; direction?: string; record?: EngineSceneRecordLine[] },
): DirectorSceneRecord {
  const note = input.note?.trim() || undefined;
  const next: DirectorSceneRecord = {
    ...current,
    ...snapshotFields(planned),
    record: input.record ?? planned.record ?? [],
    directorNotes: planned.directorNotes.length > 0 ? planned.directorNotes : current.directorNotes,
    previous: snapshotOf(current),
    showingPrevious: false,
  };
  if (input.direction !== undefined) next.direction = input.direction;
  if (note) next.note = note;
  else delete next.note;
  delete next.draft;
  return next;
}

function snapshotFields(planned: EngineBeatSheet): Partial<DirectorSceneRecord> {
  return {
    title: planned.title,
    description: planned.description,
    goal: planned.goal,
    beats: planned.beats,
    pov: planned.pov,
    presence: planned.presence,
    location: planned.location,
    timeAnchor: planned.timeAnchor,
    valueShift: planned.valueShift,
    preflight: planned.preflight,
    status: planned.status,
  };
}

/** Regenerate this beat: only that row changes; the rest of the card, and the previous card, stay. */
export function applyRegeneratedBeat(
  current: DirectorSceneRecord,
  planned: EngineBeatSheet,
  beatId: string,
  record?: EngineSceneRecordLine[],
): DirectorSceneRecord {
  const replacement = planned.beats.find((b) => b.beatId === beatId);
  if (!replacement) throw new Error(`The regenerated plan has no beat ${beatId}`);
  return {
    ...current,
    beats: current.beats.map((b) => (b.beatId === beatId ? { ...replacement, order: b.order } : b)),
    record: record ?? planned.record ?? current.record,
  };
}

/** Swap the card on show with the previous one ("Previous card" / "Newer card"). */
export function swapPrevious(current: DirectorSceneRecord): DirectorSceneRecord {
  if (!current.previous) return current;
  const swapped = withSnapshot(current, current.previous);
  return { ...swapped, previous: snapshotOf(current), showingPrevious: !current.showingPrevious };
}

/** A beat as the writer shaped it by hand. `beatId` absent = a beat the writer added. */
export interface EditedBeat {
  beatId?: string;
  intent: string;
}

/**
 * Hand edits: reword, remove, reorder, add. Free, like all writing. A beat whose line the writer changed loses its
 * declared effects and its change line, which described the planner's version and would otherwise make the prose
 * express something the writer took out. A record line about an edited or removed beat is dropped with it.
 */
export function applyBeatEdits(current: DirectorSceneRecord, edited: ReadonlyArray<EditedBeat>): DirectorSceneRecord {
  const byId = new Map(current.beats.map((b) => [b.beatId, b]));
  const usedIds = new Set(current.beats.map((b) => b.beatId));
  let nextNumber = current.beats.reduce((max, b) => Math.max(max, beatNumber(b.beatId)), 0);
  const changedIds = new Set<string>();

  const beats: EngineBeat[] = edited
    .map((e) => ({ ...e, intent: e.intent.trim() }))
    .filter((e) => e.intent.length > 0)
    .map((e, index) => {
      const prior = e.beatId ? byId.get(e.beatId) : undefined;
      if (prior && prior.intent === e.intent) return { ...prior, order: index + 1 };
      if (prior) {
        changedIds.add(prior.beatId);
        return {
          ...prior,
          order: index + 1,
          intent: e.intent,
          knowledgeEffects: [],
          stateEffects: [],
          turn: undefined,
          status: "planned" as const,
        };
      }
      do nextNumber += 1;
      while (usedIds.has(`bt_${nextNumber}`));
      const beatId = `bt_${nextNumber}`;
      usedIds.add(beatId);
      return {
        beatId,
        order: index + 1,
        intent: e.intent,
        pacing: "standard" as const,
        entityIds: [],
        knowledgeEffects: [],
        stateEffects: [],
        directions: [],
        status: "planned" as const,
      };
    })
    .map((b) => (b.turn === undefined ? omitTurn(b) : b));

  const kept = new Set(beats.map((b) => b.beatId));
  const record = (current.record ?? []).filter(
    (line) => !line.beatId || (kept.has(line.beatId) && !changedIds.has(line.beatId)),
  );
  return { ...current, beats, record: renumberRecord(record, beats) };
}

function omitTurn(beat: EngineBeat): EngineBeat {
  const rest = { ...beat };
  delete rest.turn;
  return rest;
}

function beatNumber(beatId: string): number {
  const match = /^bt_(\d+)$/.exec(beatId);
  return match ? Number(match[1]) : 0;
}

function renumberRecord(record: EngineSceneRecordLine[], beats: EngineBeat[]): EngineSceneRecordLine[] {
  const orderOf = new Map(beats.map((b) => [b.beatId, b.order]));
  return record.map((line) =>
    line.beatId && orderOf.has(line.beatId) ? { ...line, beatOrder: orderOf.get(line.beatId) } : line,
  );
}

/** The whole draft arrives. Each beat keeps its passage so a remount, or Rewrite this beat, can find it. */
export function applyDraft(
  current: DirectorSceneRecord,
  written: EngineRenderSceneResponse,
  precedingTail?: string,
  mark?: PlacementMark,
): DirectorSceneRecord {
  const draft: SceneDraft = {
    text: written.text,
    wordCount: written.wordCount,
    spans: written.spans,
    ...(precedingTail !== undefined ? { precedingTail } : {}),
  };
  const { mark: _gone, ...rest } = current;
  return {
    ...rest,
    ...(mark ? { mark } : {}),
    draft,
    status: "rendering",
    beats: current.beats.map((b) => {
      const span = written.spans.find((s) => s.beatId === b.beatId);
      return span
        ? { ...b, status: "rendered" as const, renderedProse: written.text.slice(span.start, span.end) }
        : b;
    }),
  };
}

/** Rewrite this beat: only that passage is replaced; the others keep their text and shift their offsets. */
export function applyRewrite(
  current: DirectorSceneRecord,
  beatId: string,
  prose: string,
  note?: string,
): DirectorSceneRecord {
  const draft = current.draft;
  if (!draft) throw new Error("There is no draft to rewrite");
  const passages = draft.spans.map((s) => ({
    ...s,
    text: s.beatId === beatId ? prose.trim() : draft.text.slice(s.start, s.end),
  }));
  if (!passages.some((p) => p.beatId === beatId)) throw new Error(`The draft has no passage for beat ${beatId}`);
  const rebuilt: SceneDraft = {
    ...joinPassages(passages),
    ...(draft.precedingTail !== undefined ? { precedingTail: draft.precedingTail } : {}),
  };
  const trimmedNote = note?.trim();
  return {
    ...current,
    draft: rebuilt,
    beats: current.beats.map((b) => {
      const span = rebuilt.spans.find((s) => s.beatId === b.beatId);
      const withProse = span ? { ...b, renderedProse: rebuilt.text.slice(span.start, span.end) } : b;
      return b.beatId === beatId && trimmedNote
        ? { ...withProse, directions: [...b.directions, trimmedNote] }
        : withProse;
    }),
  };
}

export function joinPassages(
  passages: ReadonlyArray<{ beatId: string; beatOrder: number; text: string }>,
): SceneDraft {
  let text = "";
  const spans: SceneDraftSpan[] = [];
  passages.forEach((p, index) => {
    if (index > 0) text += "\n\n";
    const start = text.length;
    text += p.text;
    spans.push({ beatId: p.beatId, beatOrder: p.beatOrder, start, end: text.length });
  });
  return { text, wordCount: countWords(text), spans };
}

/** Counted as the rest of the plugin counts, so a script with no spaces does not read as one word. */
export const countWords = (text: string): number => wordsOf(text);

/** Discard truly discards: the draft and every beat's prose are gone and the card is unwritten again. */
export function applyDiscard(current: DirectorSceneRecord): DirectorSceneRecord {
  const next: DirectorSceneRecord = {
    ...current,
    status: "drafting",
    beats: current.beats.map((b) => {
      const rest: EngineBeat = { ...b, status: "planned" };
      delete rest.renderedProse;
      delete rest.renderedRev;
      delete rest.renderedFormat;
      return rest;
    }),
  };
  delete next.draft;
  delete next.mark;
  return next;
}

/**
 * Kept: the draft is now ordinary text in the chapter. Each beat is tied to its passage by content hash, the
 * previous card is let go (it was kept only until the scene was written), and the one-time check offer opens.
 */
export function applyKept(current: DirectorSceneRecord, pageId: string, nowIso: string): DirectorSceneRecord {
  if (isKept(current)) throw new Error("This scene is already in the chapter");
  if (!current.draft) throw new Error("There is no draft to keep");
  const draft = current.draft;
  const next: DirectorSceneRecord = {
    ...current,
    anchor: { ...current.anchor, pageId },
    status: "placed",
    kept: { pageId, keptAtIso: nowIso },
    checkOffer: true,
    beats: current.beats.map((b) => {
      const span = draft.spans.find((s) => s.beatId === b.beatId);
      const passage = span ? draft.text.slice(span.start, span.end) : (b.renderedProse ?? "");
      return {
        ...b,
        status: "accepted" as const,
        renderedRev: sha256(passage),
      };
    }),
  };
  delete next.previous;
  delete next.showingPrevious;
  delete next.mark;
  // The prose it continued from is the manuscript's own, and no rewrite will need it now.
  if (next.draft) next.draft = { text: next.draft.text, wordCount: next.draft.wordCount, spans: next.draft.spans };
  return next;
}

/**
 * Text before the passage `beatId` (the prose the scene was written from, else the chapter as it stands, plus the
 * draft's earlier passages) and the passage after.
 */
export function rewriteContext(
  draft: SceneDraft,
  beatId: string,
  chapterText: string,
): { precedingProse: string; followingProse: string } {
  const before = draft.precedingTail ?? chapterText;
  const index = draft.spans.findIndex((s) => s.beatId === beatId);
  if (index === -1) throw new Error(`The draft has no passage for beat ${beatId}`);
  const span = draft.spans[index];
  const earlier = draft.text.slice(0, span.start).trim();
  const next = draft.spans[index + 1];
  return {
    precedingProse: [before.trim(), earlier].filter(Boolean).join("\n\n"),
    followingProse: next ? draft.text.slice(next.start, next.end) : "",
  };
}

/** One scene's one draft: a Keep retried after the scene was placed is recognised and never placed twice. */
export function keptInsertKey(sceneId: string, prose: string): string {
  return `${sceneId}:${prose.length}:${sha256(prose).slice(0, 16)}`;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function parseDraft(value: unknown): SceneDraft | null {
  if (!record(value) || typeof value.text !== "string" || value.text.trim() === "" || typeof value.wordCount !== "number" || !validSpans(value.spans, value.text.length)) return null;
  return { text: value.text, wordCount: value.wordCount, spans: value.spans, ...(typeof value.precedingTail === "string" ? { precedingTail: value.precedingTail } : {}) };
}
function parseMark(value: unknown): PlacementMark | null {
  return record(value) && typeof value.offset === "number" && value.offset >= 0 && typeof value.before === "string" ? { offset: value.offset, before: value.before } : null;
}

/** A scene from its file, which can be synced or hand-edited. Anything the panel or Keep would trust has to hold, or the scene reads as damaged. */
export function parseSceneRecord(value: unknown): DirectorSceneRecord | null {
  const sheet = parseBeatSheet(value);
  if (!sheet || !record(value)) return null;
  const scene = { ...sheet } as DirectorSceneRecord;
  if (value.draft !== undefined) { const draft = parseDraft(value.draft); if (!draft) return null; scene.draft = draft; }
  if (value.mark !== undefined) { const mark = parseMark(value.mark); if (!mark) return null; scene.mark = mark; }
  if (value.kept !== undefined && !(record(value.kept) && typeof value.kept.pageId === "string" && typeof value.kept.keptAtIso === "string")) return null;
  if (value.direction !== undefined && typeof value.direction !== "string") return null;
  if (value.note !== undefined && typeof value.note !== "string") return null;
  if (value.previous !== undefined && !(record(value.previous) && typeof value.previous.goal === "string" && Array.isArray(value.previous.beats) && value.previous.beats.every(validBeat))) return null;
  return scene;
}
