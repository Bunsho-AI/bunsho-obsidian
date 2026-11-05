/** The Director's wire shapes (engine src/types/director.ts, one contract with it and with the desktop's engine.types.ts). */
import type { EngineTracking } from "@/helpers/director/world";

export interface EngineKnowledgeEffect { entityId: string; propositionKey: string; proposition: string; polarity: string; learnedHow?: string }
export interface EngineStateEffect { entityId: string; dimension: string; value: string; stability: string; transition: string }

export interface EngineBeat {
  beatId: string;
  order: number;
  /** What happens, in the writer's terms. */
  intent: string;
  /** What changes because of it. */
  turn?: string;
  pacing: "flash" | "standard" | "expansive";
  entityIds: string[];
  knowledgeEffects: EngineKnowledgeEffect[];
  stateEffects: EngineStateEffect[];
  dialogue?: unknown[];
  blocking?: unknown[];
  directions: string[];
  status: "planned" | "approved" | "rendered" | "accepted" | "redo";
  renderedRev?: string;
  renderedProse?: string;
  renderedFormat?: "fountain";
}

export interface EngineSceneRecordLine { rank: "canon" | "found"; beatId?: string; beatOrder?: number; message: string; pageId?: string; pageOrder?: number }
export interface EngineScenePresence { entityId: string; canonicalName: string; role: string }
export interface EngineSceneAnchor { pageId: string; placement: "cursor" | "append" }

export interface EngineBeatSheet {
  version: 1;
  sceneId: string;
  title?: string;
  anchor: EngineSceneAnchor;
  directorNotes: string[];
  pov: { mode: string; character?: string; tense: string };
  location?: string;
  timeAnchor?: string;
  presence: EngineScenePresence[];
  valueShift?: { entering: string; exiting: string };
  goal: string;
  description?: string;
  beats: EngineBeat[];
  status: "drafting" | "planned" | "rendering" | "placed" | "checked";
  preflight?: unknown[];
  record?: EngineSceneRecordLine[];
  createdAtIso?: string;
}

export interface EnginePlanRequest {
  direction: string;
  targetPageId: string;
  pageOrder: number;
  precedingProse: string;
  tracking: EngineTracking;
  scene?: EngineBeatSheet;
  regenerate?: { note?: string };
  regenerateBeat?: { beatId: string; note?: string };
}
export interface EnginePlanResponse { scene: EngineBeatSheet; record: EngineSceneRecordLine[] }

export interface EngineRenderSceneRequest { scene: EngineBeatSheet; tracking: EngineTracking; precedingProse: string }
export interface EngineRenderSceneResponse { text: string; wordCount: number; spans: { beatId: string; beatOrder: number; start: number; end: number }[] }

export interface EngineRenderBeatRequest { scene: EngineBeatSheet; beatId: string; tracking: EngineTracking; precedingProse: string; followingProse?: string }
export interface EngineRenderBeatResponse { prose: string }

/** The engine's price list keys (GET /v1/credits opCosts). */
export const PLAN_OP = "plan_scene";
export const RENDER_OP = "render_beat";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((s) => typeof s === "string");
const optional = (value: unknown, type: "string" | "number"): boolean => value === undefined || typeof value === type;

function validBeat(value: unknown): value is EngineBeat {
  return record(value) && typeof value.beatId === "string" && value.beatId.length > 0 && typeof value.order === "number" && typeof value.intent === "string" && optional(value.turn, "string")
    && (value.pacing === "flash" || value.pacing === "standard" || value.pacing === "expansive") && strings(value.entityIds) && Array.isArray(value.knowledgeEffects) && Array.isArray(value.stateEffects)
    && strings(value.directions) && typeof value.status === "string" && optional(value.renderedProse, "string") && optional(value.renderedRev, "string");
}
function validRecordLine(value: unknown): value is EngineSceneRecordLine {
  return record(value) && (value.rank === "canon" || value.rank === "found") && typeof value.message === "string" && optional(value.beatId, "string") && optional(value.beatOrder, "number") && optional(value.pageId, "string");
}

/** A beat sheet as the engine sent it, or as a file holds it. Null when it is not one: the card reads every part of this. */
export function parseBeatSheet(value: unknown): EngineBeatSheet | null {
  if (!record(value) || value.version !== 1 || typeof value.sceneId !== "string" || typeof value.goal !== "string" || !strings(value.directorNotes)) return null;
  if (!record(value.anchor) || typeof value.anchor.pageId !== "string" || (value.anchor.placement !== "cursor" && value.anchor.placement !== "append")) return null;
  if (!record(value.pov) || typeof value.pov.mode !== "string" || typeof value.pov.tense !== "string" || !Array.isArray(value.presence)) return null;
  if (!Array.isArray(value.beats) || !value.beats.every(validBeat) || typeof value.status !== "string") return null;
  if (value.record !== undefined && !(Array.isArray(value.record) && value.record.every(validRecordLine))) return null;
  if (!optional(value.title, "string") || !optional(value.description, "string") || !optional(value.createdAtIso, "string")) return null;
  return value as unknown as EngineBeatSheet;
}

export function parsePlanResponse(value: unknown): EnginePlanResponse | null {
  if (!record(value)) return null;
  const scene = parseBeatSheet(value.scene);
  if (!scene) return null;
  const lines = Array.isArray(value.record) ? value.record.filter(validRecordLine) : scene.record ?? [];
  return { scene, record: lines };
}

/** Spans over the text, in bounds: Rewrite slices the draft by them. */
export function validSpans(value: unknown, length: number): value is EngineRenderSceneResponse["spans"] {
  return Array.isArray(value) && value.every((s) => record(s) && typeof s.beatId === "string" && typeof s.beatOrder === "number" && typeof s.start === "number" && typeof s.end === "number" && s.start >= 0 && s.start <= s.end && s.end <= length);
}

export function parseRenderScene(value: unknown): EngineRenderSceneResponse | null {
  if (!record(value) || typeof value.text !== "string" || value.text.trim() === "" || typeof value.wordCount !== "number" || !validSpans(value.spans, value.text.length)) return null;
  return { text: value.text, wordCount: value.wordCount, spans: value.spans };
}

export function parseRenderBeat(value: unknown): EngineRenderBeatResponse | null {
  return record(value) && typeof value.prose === "string" && value.prose.trim() !== "" ? { prose: value.prose } : null;
}
