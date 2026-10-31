/** Non-empty lines: how the engine counts a page's paragraphs (engine text/manuscript.ts paragraphs()). */
export function paragraphCount(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) if (line.trim()) count++;
  return count;
}
