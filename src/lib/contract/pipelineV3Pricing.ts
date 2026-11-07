/**
 * Continuity pipeline v3 pricing: one formula for the quote the writer sees (renderer) and the checks
 * main runs, mirroring bunsho-engine src/claims/transport/session.ts `reviewUnits` and credits.service.ts
 * OP_COSTS.pipeline_v3_kchar (one contract; founder decision 2026-09-26).
 *
 * A review costs `units x creditsPerThousandChars`, where units = max(minimumUnits, ceil(checkedChars / 1000))
 * is rounded up ONCE per review, and checkedChars is the length (JavaScript string length, spaces
 * included) of the text of every page sent WHOLE. Passages from other pages are not charged.
 */

export const PIPELINE_V3_PRICE_OP = "pipeline_v3_kchar" as const;
/** "Check canon" (founder 2026-09-27): the writer's pins alone across the whole book, same units, its own rate, plus a
 *  price per pinned fact (engine session.ts canonUnits; health `pricing.canonCreditsPerPin`). */
export const PIPELINE_V3_CANON_PRICE_OP = "pipeline_v3_canon_kchar" as const;
/** Mirrors the engine's MIN_REVIEW_UNITS; the engine's health `pricing.minimumUnits` wins once read. */
export const PIPELINE_V3_MIN_REVIEW_UNITS = 3;
export const PIPELINE_V3_CHARS_PER_UNIT = 1000;

/** The price inputs a quote needs. `creditsPerThousandChars` null: price from /v1/credits opCosts[op]. */
export interface PipelineV3PriceFormula {
  op: typeof PIPELINE_V3_PRICE_OP | typeof PIPELINE_V3_CANON_PRICE_OP;
  creditsPerThousandChars: number | null;
  minimumUnits: number;
}

const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** The engine's `reviewUnits`: null when the inputs are not counts. */
export function pipelineV3ReviewUnits(checkedChars: number, minimumUnits: number = PIPELINE_V3_MIN_REVIEW_UNITS): number | null {
  if (!count(checkedChars) || !count(minimumUnits)) return null;
  return Math.max(minimumUnits, Math.ceil(checkedChars / PIPELINE_V3_CHARS_PER_UNIT));
}

/** Characters one review is charged for: every page sent whole, exactly as sent. */
export function pipelineV3CheckedChars(texts: readonly string[]): number {
  return texts.reduce((sum, text) => sum + text.length, 0);
}

/**
 * Credits one review of `checkedChars` costs. The engine's health price is used when known, else the
 * /v1/credits price table's; null when neither is known or the count is not a count (no number is shown,
 * the writer still confirms).
 */
export function pipelineV3ReviewCredits(formula: PipelineV3PriceFormula, checkedChars: number | null | undefined,
  opCosts?: Record<string, number>): number | null {
  const price = formula.creditsPerThousandChars ?? opCosts?.[formula.op];
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return null;
  if (typeof checkedChars !== "number") return null;
  const units = pipelineV3ReviewUnits(checkedChars, formula.minimumUnits);
  return units === null ? null : units * price;
}

/**
 * Credits one "Check canon" pass costs: the book's characters at the canon rate plus `creditsPerPin` per pinned fact.
 * An engine that advertises no per-pin price charges none. Null when the character price is unknown.
 */
export function pipelineV3CanonCredits(formula: PipelineV3PriceFormula, checkedChars: number | null | undefined, pins: number,
  creditsPerPin: number | null | undefined, opCosts?: Record<string, number>): number | null {
  const chars = pipelineV3ReviewCredits(formula, checkedChars, opCosts);
  if (chars === null) return null;
  const perPin = typeof creditsPerPin === "number" && Number.isFinite(creditsPerPin) && creditsPerPin >= 0 ? creditsPerPin : 0;
  return chars + perPin * Math.max(0, pins);
}
