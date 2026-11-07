/** Shared plugin types: persisted data and the controller's state, read by pages and passed down to components. */
import type { Chapter, SkippedNote } from "@/helpers/chapters";
import type { ProjectState } from "@/helpers/project";
import type { PipelineV3Health } from "@/lib/contract/pipelineV3.types";
import type { ReviewOutcome } from "@/lib/services/review/reviewService";

export interface PluginData {
  manuscriptFolder: string;
  engineUrl: string;
  /** Local development only (engine with AUTH_OPTIONAL=true). Shown in settings only for a localhost engine. */
  devUid: string;
  installId: string;
  workspaceId: string;
  dismissed: string[];
  lastReview: ReviewOutcome | null;
}

export type Scan =
  | { status: "no_folder" }
  | { status: "no_notes" }
  | { status: "ready"; chapters: Chapter[]; skipped: SkippedNote[]; chars: number; words: number; snapshotId: string };

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
  /** The Free tier's one-project rule for this manuscript (helpers/project.ts). */
  project: ProjectState;
  registeredName: string | null;
}

export const SIGNED_OUT: Account = { signedIn: false, balance: null, health: null, problem: null, project: "unknown", registeredName: null };
