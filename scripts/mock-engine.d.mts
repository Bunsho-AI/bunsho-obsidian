export const POLICY_ID: string;
export const READ_POLICY_ID: string;
export interface MockEngineOptions { port?: number; balance?: number; tamper?: boolean | "prior"; failWith?: string | null }
export interface MockEngine {
  port: number;
  requests: Array<{ url?: string; headers: Record<string, string | string[] | undefined>; socket?: boolean }>;
  close(): Promise<void>;
}
export function startMockEngine(options?: MockEngineOptions): Promise<MockEngine>;
export function findings(start: unknown, pages: Map<string, string>): unknown[];
