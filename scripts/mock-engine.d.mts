export const POLICY_ID: string;
export const READ_POLICY_ID: string;
export interface MockFailure { code: string; message: string; charged: boolean }
/** What the engine can do, set at start or by POST /__mock while it runs. */
export interface MockBehaviour {
  failAfterReads: MockFailure | null;
  refuseCached: boolean;
  unread: string[] | "all";
  capped: boolean;
  findNothing: boolean;
  readPolicy: string | null;
  failWith: string | null;
  tamper: boolean | "prior";
  tickMs: number;
  policyId?: string;
  currentReadPolicy?: string;
}
export interface MockEngineOptions extends Partial<MockBehaviour> { port?: number; balance?: number; holdOpen?: boolean; paid?: boolean; registered?: { workspaceId: string; name?: string | null } | null; starter?: number; readingParts?: boolean; enforce?: boolean }
export interface MockStart {
  reviewId: string;
  scope: string;
  maxCredits?: number;
  focusNames: string[];
  cachedReads: Array<{ pageId: string; rev: string; order: number; facts: unknown[] }>;
  pages: Array<{ pageId: string; order: number; rev: string; send: string; part?: { sourceId: string; sourceOrder: number; index: number; of: number } }>;
}
export interface MockEngine {
  port: number;
  requests: Array<{ url?: string; headers: Record<string, string | string[] | undefined>; socket?: boolean }>;
  /** Every review's start payload, as sent. */
  starts: MockStart[];
  /** Every page's text, as sent whole. */
  sentPages: Array<{ pageId: string; text: string }>;
  /** Every passages frame, as sent. */
  sentPassages: Array<{ pageId: string; paragraphs: Array<{ index: number; start: number; end: number; text: string }> }>;
  options: MockBehaviour;
  balance(): number;
  registration(): { workspaceId: string; name: string | null } | null;
  close(): Promise<void>;
}
export function startMockEngine(options?: MockEngineOptions): Promise<MockEngine>;
export function findings(start: unknown, pages: Map<string, string>): unknown[];
export function readsOf(start: unknown, pages: Map<string, string>): unknown[];
