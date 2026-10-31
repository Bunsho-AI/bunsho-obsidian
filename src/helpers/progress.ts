/** Overall share of a review from the engine's per-stage progress (desktop pipelineV3Progress.ts weights). */
import type { ClaimsProgress, ClaimsStage } from "@/lib/contract/pipelineV3.types";

const GROUPS: ReadonlyArray<{ weight: number; stages: readonly ClaimsStage[] }> = [
  { weight: 0.4, stages: ["read"] },
  { weight: 0.25, stages: ["cast", "search", "triage"] },
  { weight: 0.3, stages: ["judge", "timeline", "names"] },
  { weight: 0.05, stages: ["assemble"] },
];

export class ProgressTracker {
  private readonly stages: Partial<Record<ClaimsStage, number>> = {};
  private share = 0;

  /** Monotonic share in [0, 1]. */
  update(progress: ClaimsProgress): number {
    const fraction = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 1;
    this.stages[progress.stage] = Math.max(this.stages[progress.stage] ?? 0, fraction);
    const next = GROUPS.reduce((sum, g) => sum + g.weight * g.stages.reduce((n, s) => n + (this.stages[s] ?? 0), 0) / g.stages.length, 0);
    this.share = Math.max(this.share, Math.min(1, next));
    return this.share;
  }
}
