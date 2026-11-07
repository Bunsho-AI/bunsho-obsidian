/** Shared plugin types: persisted data and the controller's state, read by pages and passed down to components. */
import type { PageMeta, PlannedItem, SavedPlan, SourceChoice } from "@/helpers/sources";
import type { ProjectState } from "@/helpers/project";
import type { PipelineV3Health } from "@/lib/contract/pipelineV3.types";
import type { ReviewOutcome } from "@/lib/services/review/reviewService";

export interface PluginData {
  /** What the writer picked: null until they do. Bunsho never guesses a folder. */
  source: SourceChoice | null;
  /** The reading plan the writer confirmed for `source`. */
  plan: SavedPlan | null;
  /** Note path -> a stable id, moved on rename, so a finding and a plan survive one. */
  noteIds: Record<string, string>;
  engineUrl: string;
  /** Local development only (engine with AUTH_OPTIONAL=true). Shown in settings only for a localhost engine. */
  devUid: string;
  installId: string;
  workspaceId: string;
  dismissed: string[];
  lastReview: ReviewOutcome | null;
}

export type Scan =
  /** Nothing picked yet. */
  | { status: "no_source" }
  /** What was picked is no longer in the vault. */
  | { status: "missing"; source: SourceChoice }
  /** Picked, with no text in it yet. */
  | { status: "empty"; source: SourceChoice }
  | {
    status: "ready"; source: SourceChoice;
    /** The plan's lines, in the writer's order. */
    items: PlannedItem[];
    /** The reading plan differs from what the writer last confirmed. */
    needsConfirming: boolean;
    /** Exactly what a check would send. Reading units are never shown. */
    pages: PageMeta[];
    chars: number; words: number; snapshotId: string;
    /** Notes with nothing to read. */
    skipped: string[];
  };

export type Phase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "confirming" }
  | { kind: "checking"; share: number; waiting: boolean; stage?: string }
  | { kind: "error"; message: string; charged?: boolean };

export interface Account {
  signedIn: boolean;
  balance: number | null;
  health: PipelineV3Health | null;
  problem: string | null;
  /** The Free tier's one-project rule for this vault (helpers/project.ts). */
  project: ProjectState;
  registeredName: string | null;
}

export const SIGNED_OUT: Account = { signedIn: false, balance: null, health: null, problem: null, project: "unknown", registeredName: null };
