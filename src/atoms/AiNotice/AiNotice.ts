/** The same line as the desktop's Continuity tab (founder, 15 Oct 2026): one quiet line, always there, never a popup. */
export const AI_MISTAKES_NOTICE = "Bunsho uses AI and can make mistakes. Check findings against your story.";

export function AiNotice(parent: HTMLElement): HTMLElement {
  return parent.createDiv({ cls: "bunsho-ai-notice", text: AI_MISTAKES_NOTICE });
}
