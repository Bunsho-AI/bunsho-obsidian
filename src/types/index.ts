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
  /** Findings the writer closed from the Resolve screen as intended. Like dismissals, they stay closed on later checks. */
  deliberate: string[];
  /** Findings Check if fixed no longer detected. Unlike a decision, a later review that finds one again reopens it. */
  fixed: string[];
  lastReview: ReviewOutcome | null;
  /** The last review stopped before it checked everything it was asked to. */
  stopped: StoppedReview | null;
}

/** What a review that did not finish read, always by plan item. */
export interface StoppedReview {
  status: "partial" | "out_of_credits";
  source: SourceChoice;
  checked: number;
  failed: number;
  total: number;
  /** What stands in the way, in the writer's terms. Gone once they have dismissed it; the status line stays. */
  message: string | null;
  /** What the review needed, to know when the writer can afford it again. */
  credits: number | null;
}

/** What a failed review was, so it can be tried again at the price it costs now. */
export type ReviewAction =
  | { kind: "full" }
  | { kind: "changes" }
  | { kind: "chapter"; itemId: string };

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
    /** Characters of each plan item as sent: what a check of it is charged for. */
    itemChars: Record<string, number>;
    /** Notes with nothing to read. */
    skipped: string[];
  };

export type Phase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "confirming" }
  | { kind: "checking"; share: number; waiting: boolean; stage?: string }
  /** `action`: the review that failed, when trying it again can help. A pre-flight refusal has none. */
  | { kind: "error"; message: string; charged?: boolean; action?: ReviewAction };

export interface Account {
  signedIn: boolean;
  balance: number | null;
  /** The plan's name, or null when the engine could not say (never read as Free). */
  planName: string | null;
  health: PipelineV3Health | null;
  problem: string | null;
  /** The Free tier's one-project rule for this vault (helpers/project.ts). */
  project: ProjectState;
  registeredName: string | null;
}

export const SIGNED_OUT: Account = { signedIn: false, balance: null, planName: null, health: null, problem: null, project: "unknown", registeredName: null };
