/**
 * The writer's pins, as the engine checks them (desktop reading/readerTracking.ts): open, stable, writer-sourced states. Knowledge
 * and dynamic facts never become pins, and aliases never reach them: a merge made by extraction carries no authority, and the
 * engine widens the search through the cast it has checked.
 */
import type { PipelineV3Pin } from "@/lib/contract/pipelineV3.types";
import { isWriterSource, validTracking, type CanonState, type CanonTracking } from "@/helpers/canon/record";
import { sha256 } from "@/utils/hash";

function validate(tracking: unknown): asserts tracking is CanonTracking {
  if (!validTracking(tracking)) throw new Error("Invalid reader tracking");
}

const activePins = (tracking: CanonTracking): CanonState[] => tracking.timeline.states
  .filter((state) => !state.closedAt && state.stability === "stable" && isWriterSource(state.openedAt))
  .sort((a, b) => a.stateId.localeCompare(b.stateId));

/** Mirrors the engine's constraint identity. Extracted graph edits, aliases, closed pins and a retained page are not new authority. */
export function writerPinDigest(tracking: unknown): string {
  validate(tracking);
  const names = new Map(tracking.entities.entities.map((entity) => [entity.entityId, entity.canonicalName]));
  const constraints = activePins(tracking).map((state) => ({
    constraintId: state.stateId, entityId: state.entityId,
    entityName: names.get(state.entityId) ?? "Unnamed entity",
    dimension: state.dimension, value: state.value,
    declaredAt: isWriterSource(state.openedAt) ? state.openedAt.declaredAt : undefined,
  }));
  return sha256(JSON.stringify(constraints));
}

export function writerPins(tracking: unknown): PipelineV3Pin[] {
  validate(tracking);
  const names = new Map(tracking.entities.entities.map((entity) => [entity.entityId, entity.canonicalName]));
  return activePins(tracking).flatMap((state) => (isWriterSource(state.openedAt) ? [{
    pinId: state.stateId, entityId: state.entityId, entityName: names.get(state.entityId) || "Unnamed entity", aliases: [],
    dimension: state.dimension, value: state.value, declaredAt: state.openedAt.declaredAt,
  }] : []));
}
