/**
 * What the engine's edge takes, by hand (bunsho-engine src/validation/tracking.schemas.ts and director.schemas.ts, bounds from limits.ts). The mock
 * engine refuses with it as the engine does, a 400 before any charge, and the tests hold the projection against it. Each returns the first
 * reason for refusal, or null. Change it with those files.
 */
const ID = 300, NAME = 200, DIMENSION = 200, VALUE = 2_000, QUOTE = 2_000, KEY = 300, TEXT = 2_000, DIRECTION = 4_000, PROSE = 50_000;
const obj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v, max) => typeof v === "string" && v.length <= max;
const int = (v) => Number.isInteger(v);
const pageSource = (s) => obj(s) && str(s.pageId, ID) && int(s.pageOrder) && str(s.quote, QUOTE) && (s.rev === undefined || str(s.rev, ID));
const source = (s) => obj(s) && (s.origin === "writer" ? str(s.declaredAt, ID) && (s.from === undefined || pageSource(s.from)) : s.origin === "seed" ? str(s.declaredAt, ID) : pageSource(s));
const POV = new Set(["first", "second", "third_limited", "third_omniscient", "third_objective"]);
const TENSE = new Set(["past", "present", "future", "mixed"]);

export function trackingProblem(t) {
  if (!obj(t) || !obj(t.entities) || !obj(t.timeline) || !obj(t.knowledge) || !obj(t.pov)) return "tracking: the four files are required";
  if (t.entities.version !== 1 || t.timeline.version !== 1 || t.knowledge.version !== 1 || t.pov.version !== 1) return "tracking: version";
  if (!Array.isArray(t.entities.entities) || t.entities.entities.length > 2_000) return "entities";
  for (const e of t.entities.entities) {
    if (!str(e.entityId, ID) || !str(e.canonicalName, NAME) || !["character", "location", "object", "organization"].includes(e.type) || !["active", "merged", "retired"].includes(e.status)) return `entity ${e.entityId}`;
    if (!Array.isArray(e.aliases) || e.aliases.some((a) => !str(a.text, NAME) || !str(a.kind, 32) || a.kind.length === 0 || typeof a.grep !== "boolean")) return `aliases of ${e.entityId}`;
    if (!Array.isArray(e.provenance) || e.provenance.length > 500 || !e.provenance.every(source)) return `provenance of ${e.entityId}`;
  }
  if (!Array.isArray(t.timeline.anchors) || !Array.isArray(t.timeline.elapsed) || !Array.isArray(t.timeline.states) || t.timeline.states.length > 20_000) return "timeline";
  for (const s of t.timeline.states) {
    if (!str(s.stateId, ID) || !str(s.entityId, ID) || !str(s.dimension, DIMENSION) || !str(s.value, VALUE) || !["stable", "dynamic"].includes(s.stability) || !source(s.openedAt) || !(s.closedAt === undefined || s.closedAt === null || source(s.closedAt))) return `state ${s.stateId}`;
  }
  if (!Array.isArray(t.knowledge.facts) || t.knowledge.facts.length > 20_000) return "knowledge";
  for (const k of t.knowledge.facts) {
    if (!str(k.knowledgeId, ID) || !str(k.entityId, ID) || !str(k.proposition, VALUE) || !str(k.propositionKey, KEY) || !["knows", "suspects", "believes_false", "unaware"].includes(k.polarity) || !source(k.learnedAt)) return `knowledge ${k.knowledgeId}`;
  }
  if (!obj(t.pov.pages)) return "pov";
  return null;
}

const effects = (b) => Array.isArray(b.knowledgeEffects) && Array.isArray(b.stateEffects) && Array.isArray(b.entityIds) && Array.isArray(b.directions) && b.directions.length <= 50 && b.directions.every((d) => str(d, TEXT));
const beat = (b) => obj(b) && str(b.beatId, ID) && int(b.order) && str(b.intent, TEXT) && (b.turn === undefined || str(b.turn, TEXT)) && ["flash", "standard", "expansive"].includes(b.pacing) && effects(b)
  && ["planned", "approved", "rendered", "accepted", "redo"].includes(b.status);

export function sheetProblem(s) {
  if (!obj(s) || s.version !== 1 || !str(s.sceneId, ID)) return "scene";
  if (!obj(s.anchor) || !str(s.anchor.pageId, ID) || !["cursor", "append"].includes(s.anchor.placement)) return "scene.anchor";
  if (!Array.isArray(s.directorNotes) || !s.directorNotes.every((n) => str(n, DIRECTION))) return "scene.directorNotes";
  if (!obj(s.pov) || !POV.has(s.pov.mode) || !TENSE.has(s.pov.tense)) return "scene.pov";
  if (!Array.isArray(s.presence) || !str(s.goal, TEXT) || !Array.isArray(s.beats) || !s.beats.every(beat)) return "scene.beats";
  return ["drafting", "planned", "rendering", "placed", "checked"].includes(s.status) ? null : "scene.status";
}

/** POST /v1/plan. */
export function planProblem(b) {
  if (!obj(b) || !str(b.direction, DIRECTION) || !str(b.targetPageId, ID) || !int(b.pageOrder) || !str(b.precedingProse, PROSE)) return "plan: fields";
  const tracking = trackingProblem(b.tracking);
  if (tracking) return tracking;
  if (b.regenerate && b.regenerateBeat) return "plan: regenerate and regenerateBeat are exclusive";
  if ((b.regenerate || b.regenerateBeat) && !b.scene) return "plan: needs the scene";
  if (b.scene) { const scene = sheetProblem(b.scene); if (scene) return scene; }
  if (b.regenerateBeat && !b.scene.beats.some((x) => x.beatId === b.regenerateBeat.beatId)) return "plan: names no beat";
  return null;
}

/** POST /v1/render/scene. */
export function renderSceneProblem(b) {
  const scene = obj(b) ? sheetProblem(b.scene) : "render";
  if (scene) return scene;
  const tracking = trackingProblem(b.tracking);
  if (tracking) return tracking;
  const n = b.scene.beats.length;
  if (n === 0 || n > 12 || new Set(b.scene.beats.map((x) => x.beatId)).size !== n) return "render: beats";
  return b.precedingProse === undefined || str(b.precedingProse, PROSE) ? null : "render: prose";
}

/** POST /v1/render/beat. */
export function renderBeatProblem(b) {
  const scene = obj(b) ? sheetProblem(b.scene) : "render";
  if (scene) return scene;
  const tracking = trackingProblem(b.tracking);
  if (tracking) return tracking;
  if (!str(b.beatId, ID) || !(b.precedingProse === undefined || str(b.precedingProse, PROSE)) || !(b.followingProse === undefined || str(b.followingProse, PROSE))) return "render: fields";
  return null;
}
