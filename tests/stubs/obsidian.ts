/** Stand-in for the parts of Obsidian's API the service tests touch (the real package has no runtime outside Obsidian). */
export async function requestUrl({ url, method, body, headers }: { url: string; method?: string; body?: string; headers?: Record<string, string> }) {
  const response = await fetch(url, { method, body, headers });
  const text = await response.text();
  let json: unknown = null;
  try { json = text ? (JSON.parse(text) as unknown) : null; } catch { json = null; }
  return { status: response.status, text, json };
}
export class Notice { constructor(readonly message: string) {} }
export class MarkdownView {}
export class TFile {}
export class TFolder {}
export const getAllTags = (): string[] => [];
export const setIcon = (): void => undefined;
