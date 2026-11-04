export const POLICY_ID: string;
export const READ_POLICY_ID: string;
export interface MockEngineOptions { port?: number; balance?: number; tamper?: boolean | "prior"; failWith?: string | null; holdOpen?: boolean; paid?: boolean; registered?: { workspaceId: string; name?: string | null } | null; starter?: number; readingParts?: boolean }
export interface MockEngine {
  port: number;
  requests: Array<{ url?: string; headers: Record<string, string | string[] | undefined>; socket?: boolean }>;
  /** Every review's start payload, as sent. */
  /** Every page's text, as sent. */
  sentPages: Array<{ pageId: string; text: string }>;
  starts: Array<{ maxCredits?: number; pages: Array<{ pageId: string; order: number; rev: string; send: string; part?: { sourceId: string; sourceOrder: number; index: number; of: number } }> }>;
  registration(): { workspaceId: string; name: string | null } | null;
  close(): Promise<void>;
}
export function startMockEngine(options?: MockEngineOptions): Promise<MockEngine>;
export function findings(start: unknown, pages: Map<string, string>): unknown[];
export function readsOf(start: unknown, pages: Map<string, string>): unknown[];
