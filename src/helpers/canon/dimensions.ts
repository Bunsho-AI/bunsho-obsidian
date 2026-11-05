/**
 * The hand-entry dimension vocabulary, copied from the desktop (shared/canon/dimensions.ts; change them together). The picker's
 * entire content: keys are structural and mirror the engine's dimension conventions, so a fact typed by hand lands in the same
 * bucket as one a check found. Labels are UI strings. Nothing here reads prose: an entity param is an id, a topic key is NFC +
 * trim + lowercase with whitespace folded, which leaves every script intact.
 */
// ============================== kinds, params, polarities ==============================

/** A state record (timeline.json) or a knowledge record (knowledge.json). */
export type CanonDimensionKind = "state" | "knowledge";

/**
 * How a family key completes to a full dimension:
 *  - `none`   — the key IS the dimension ("appearance:eye_color", "trait");
 *  - `entity` — `<family>:<entityId>` (relationship, possession);
 *  - `topic`  — `<family>:<topicKey>` (stance).
 */
export type CanonDimensionParam = "none" | "entity" | "topic";

/**
 * What the writer supplies as the second part of a two-part dimension
 * (design §3): the object held (`possession`), the other entity
 * (`relationship`), the topic (`stance`). Presentation-side twin of `param`.
 */
export type CanonDimensionDetail = "object" | "entity" | "topic";

/** Mirrors the engine's STABILITY literals (asserted equal in the spec). */
export type CanonStability = "stable" | "dynamic";

/** Mirrors the engine's KnowledgePolarity (bunsho-engine/src/types/tracking.ts). */
export type CanonKnowledgePolarity = "knows" | "suspects" | "believes_false" | "unaware";

export const KNOWLEDGE_POLARITIES: readonly CanonKnowledgePolarity[] = [
  "knows",
  "suspects",
  "believes_false",
  "unaware",
];

export function isKnowledgePolarity(value: unknown): value is CanonKnowledgePolarity {
  return typeof value === "string" && (KNOWLEDGE_POLARITIES as readonly string[]).includes(value);
}

export function isCanonStability(value: unknown): value is CanonStability {
  return value === "stable" || value === "dynamic";
}

// ============================== the vocabulary ==============================

export interface CanonDimensionEntry {
  /**
   * The engine dimension key for an unparametrised entry ("appearance:eye_color",
   * "trait"), the FAMILY prefix for a parametrised one ("relationship" →
   * "relationship:<entityId>"), or the POLARITY for a knowledge entry
   * ("knows"). Unique across the table; the entry's identity.
   */
  key: string;
  /** The UI string — sentence case ("Eye colour", "Relationship with"). Translates. */
  label: string;
  kind: CanonDimensionKind;
  param: CanonDimensionParam;
  /** Present on the four two-part dimensions only; the detail field appears for exactly these. */
  detail?: CanonDimensionDetail;
  /**
   * The stability a hand-typed fact takes when the request names none.
   * Declared truths (eye colour, a relationship) are stable; passing
   * conditions (where someone is, an injury, who holds what) are dynamic.
   * State entries only.
   */
  stability?: CanonStability;
  /** Knowledge entries only: the polarity the key IS. */
  polarity?: CanonKnowledgePolarity;
}

export interface CanonDimensionGroup {
  id: "appearance" | "character" | "circumstance" | "knowledge";
  /** The group's UI string ("Appearance", "What they know"). */
  label: string;
  /** Set on the knowledge group: its entries make knowledge records, not states. */
  kind?: "knowledge";
  items: readonly CanonDimensionEntry[];
}

/**
 * The vocabulary, grouped as the picker offers it (design canvas panel F).
 * `appearance:hair` is offered as STABLE by default — the writer declaring
 * hair in a bible means a standing fact; the extractor records prose hair
 * as dynamic (changeable by choice) and stableTraitConflict exempts it, so a
 * hand-declared stable hair only ever meets canonConflict, which is the
 * writer-outranks-machine guard.
 */
export const DIMENSION_GROUPS: readonly CanonDimensionGroup[] = [
  {
    id: "appearance",
    label: "Appearance",
    items: [
      { key: "appearance:eye_color", label: "Eye colour", kind: "state", param: "none", stability: "stable" },
      { key: "appearance:hair", label: "Hair", kind: "state", param: "none", stability: "stable" },
      { key: "appearance:build", label: "Build", kind: "state", param: "none", stability: "stable" },
      { key: "appearance:age", label: "Age", kind: "state", param: "none", stability: "stable" },
      { key: "appearance:height", label: "Height", kind: "state", param: "none", stability: "stable" },
      { key: "appearance:distinguishing_mark", label: "Distinguishing mark", kind: "state", param: "none", stability: "stable" },
    ],
  },
  {
    id: "character",
    label: "Character",
    items: [
      { key: "trait", label: "Personality trait", kind: "state", param: "none", stability: "stable" },
      { key: "motivation", label: "Motivation", kind: "state", param: "none", stability: "stable" },
      { key: "voice", label: "Voice", kind: "state", param: "none", stability: "stable" },
    ],
  },
  {
    id: "circumstance",
    label: "Circumstance",
    items: [
      { key: "location", label: "Location", kind: "state", param: "none", stability: "dynamic" },
      { key: "injury", label: "Injury", kind: "state", param: "none", stability: "dynamic" },
      { key: "possession", label: "Possession of", kind: "state", param: "entity", detail: "object", stability: "dynamic" },
      { key: "relationship", label: "Relationship with", kind: "state", param: "entity", detail: "entity", stability: "stable" },
      { key: "stance", label: "Stance on", kind: "state", param: "topic", detail: "topic", stability: "stable" },
    ],
  },
  {
    id: "knowledge",
    label: "What they know",
    kind: "knowledge",
    items: [
      { key: "knows", label: "Knows", kind: "knowledge", param: "none", polarity: "knows" },
      { key: "suspects", label: "Suspects", kind: "knowledge", param: "none", polarity: "suspects" },
      { key: "believes_false", label: "Believes false", kind: "knowledge", param: "none", polarity: "believes_false" },
      { key: "unaware", label: "Unaware of", kind: "knowledge", param: "none", polarity: "unaware" },
    ],
  },
];

/** The vocabulary flattened, in picker order. */
export const CANON_DIMENSIONS: readonly CanonDimensionEntry[] = DIMENSION_GROUPS.flatMap((g) => g.items);

/**
 * The C1 composer's coarse keys — accepted on READ (already-written files
 * carry them; `trait`/`location`/`voice` are also proper entries) but no
 * longer written by the composer. Bare "appearance" is the one legacy key
 * that is not in the vocabulary.
 */
export const LEGACY_DIMENSION_KEYS: readonly string[] = ["appearance", "trait", "location", "voice"];

const BY_KEY: ReadonlyMap<string, CanonDimensionEntry> = new Map(CANON_DIMENSIONS.map((e) => [e.key, e]));
const GROUP_OF: ReadonlyMap<string, CanonDimensionGroup> = new Map(
  DIMENSION_GROUPS.flatMap((g) => g.items.map((e) => [e.key, g] as const)),
);

/** The entry whose `key` is `key` (family key for parametrised entries; polarity for knowledge), or undefined. */
export function dimensionEntry(key: string): CanonDimensionEntry | undefined {
  return BY_KEY.get(key);
}

/** The group an entry belongs to, or undefined for a key outside the table. */
export function dimensionGroup(key: string): CanonDimensionGroup | undefined {
  return GROUP_OF.get(key);
}

/** State-kind entries only. */
export function stateDimensionEntries(): CanonDimensionEntry[] {
  return CANON_DIMENSIONS.filter((e) => e.kind === "state");
}

/** Knowledge-kind entries only (the four polarities). */
export function knowledgeDimensionEntries(): CanonDimensionEntry[] {
  return CANON_DIMENSIONS.filter((e) => e.kind === "knowledge");
}

/** "state" for a state entry, "knowledge" for a polarity entry; "state" for an unknown key. */
export function dimensionKind(baseKey: string): CanonDimensionKind {
  return dimensionEntry(baseKey)?.kind === "knowledge" ? "knowledge" : "state";
}

/** True for exactly the four two-part dimensions (design §3). */
export function needsDetail(baseKey: string): boolean {
  return Boolean(dimensionEntry(baseKey)?.detail);
}

// ============================== keys ==============================

/**
 * A stance TOPIC or knowledge PROPOSITION → its structural key: NFC + trim +
 * lowercase, runs of Unicode whitespace folded to one underscore. A KEY, not
 * prose: no punctuation stripping, no stop-words, no Latin transliteration
 * (any of those would be language-bound). Empty when nothing usable was typed.
 */
export function topicKey(raw: string): string {
  return raw.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, "_");
}

/**
 * Cap a KEY to `max` UTF-16 units without splitting a surrogate pair (a
 * truncated key is still a key; a torn code point is not valid text).
 */
export function capKey(key: string, max: number): string {
  if (key.length <= max) return key;
  let out = "";
  for (const cp of key) {
    if (out.length + cp.length > max) break;
    out += cp;
  }
  return out;
}

/**
 * The propositionKey a hand-typed knowledge fact carries — same derivation
 * as `topicKey`, capped to the engine's propositionKey bound when `max` is
 * given (the proposition itself may run to MAX_PROPOSITION_CHARS).
 */
export function propositionKeyOf(proposition: string, max?: number): string {
  const key = topicKey(proposition);
  return typeof max === "number" ? capKey(key, max) : key;
}

/**
 * Complete an entry to the dimension string written into timeline.json.
 *  - `none`   → the key itself (`param` ignored);
 *  - `entity` → `${key}:${entityId}` — the raw id, untouched (ids are opaque);
 *  - `topic`  → `${key}:${topicKey(param)}`.
 * Returns null when a parametrised entry gets no usable param, or for a
 * knowledge entry (it has no dimension string).
 */
export function buildDimensionKey(entry: CanonDimensionEntry, param?: string): string | null {
  if (entry.kind !== "state") return null;
  if (entry.param === "none") return entry.key;
  const raw = typeof param === "string" ? param.trim() : "";
  if (!raw) return null;
  if (entry.param === "entity") return `${entry.key}:${raw}`;
  const topic = topicKey(raw);
  return topic ? `${entry.key}:${topic}` : null;
}

/**
 * The resolved key the composer shows at its right (`appearance:height`,
 * `relationship:ent_mira`, `knows`): the base key alone when the dimension
 * takes no detail or none was given yet, else the completed dimension.
 */
export function dimensionKey(baseKey: string, detail?: string | null): string {
  const entry = dimensionEntry(baseKey);
  if (!entry || !entry.detail) return baseKey;
  if (!detail) return baseKey;
  return buildDimensionKey(entry, detail) ?? baseKey;
}

export interface ParsedDimensionKey {
  /** The vocabulary entry the key belongs to. */
  entry: CanonDimensionEntry;
  /** The entity id (param `entity`) or topic key (param `topic`); null for `none`. */
  param: string | null;
}

/**
 * The inverse of buildDimensionKey over an on-disk dimension string: an
 * exact vocabulary key first ("appearance:eye_color" is one entry, not
 * family "appearance" + param), then `<family>:<rest>` for the parametrised
 * families. Null for anything else — a legacy coarse key, a knowledge
 * polarity, or an engine-only dimension the vocabulary does not offer (a
 * read model shows those raw; the pen simply cannot compose them).
 */
export function parseDimensionKey(key: string): ParsedDimensionKey | null {
  const exact = BY_KEY.get(key);
  if (exact && exact.kind === "state" && exact.param === "none") return { entry: exact, param: null };
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const family = BY_KEY.get(key.slice(0, idx));
  if (!family || family.kind !== "state" || family.param === "none") return null;
  const param = key.slice(idx + 1);
  if (!param) return null;
  return { entry: family, param };
}

/** True for a dimension string the vocabulary can compose (parametrised or not). */
export function isVocabularyDimension(key: string): boolean {
  return parseDimensionKey(key) !== null;
}

/** True for one of the C1 coarse keys (see LEGACY_DIMENSION_KEYS). */
export function isLegacyDimensionKey(key: string): boolean {
  return LEGACY_DIMENSION_KEYS.includes(key);
}

// ============================== labels ==============================

export interface DimensionLabelOptions {
  /** The detail's display form (the other entity's NAME, the humanised topic) for a two-part key. */
  detailLabel?: string;
  /** What to show for a key outside the table (`humanDimension` — the extractor's own keys). */
  fallback?: (rawKey: string) => string;
}

/**
 * The label the ROW carries — LOOKED UP, never parsed (design §3, ported
 * verbatim from canonDimensions.js). An exact entry gives its label; a
 * two-part key (`relationship:ent_mira`, `stance:the_deed`) gives
 * `<family label> <detailLabel>` (the raw suffix, underscores spaced, when
 * no detailLabel was resolved); a family key alone gives its label; anything
 * else falls to `fallback` (humanDimension is the fallback only) or the raw
 * key with underscores spaced.
 */
export function dimensionLabel(rawKey: string, { detailLabel, fallback }: DimensionLabelOptions = {}): string {
  const entry = dimensionEntry(rawKey);
  if (entry && !entry.detail) return entry.label;
  // A bare family key with its detail supplied (the composer's preview while
  // the key is still being completed): "Relationship with Mira Vale".
  if (entry && entry.detail && detailLabel) return `${entry.label} ${detailLabel}`;
  const cut = rawKey.indexOf(":");
  if (cut > -1) {
    const base = dimensionEntry(rawKey.slice(0, cut));
    if (base && base.detail) {
      return `${base.label} ${detailLabel || rawKey.slice(cut + 1).replace(/_/g, " ")}`.trim();
    }
  }
  if (entry) return entry.label;
  return fallback ? fallback(rawKey) : rawKey.replace(/_/g, " ");
}
