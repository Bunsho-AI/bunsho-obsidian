/** The record disagrees with the plan. It never blocks and has no Dismiss: it clears when the card no longer contradicts the record. Pinned canon is rank 1. */
export function SceneRecordLine(parent: HTMLElement, { rank, chapterOrdinal, text }: { rank: "canon" | "found"; chapterOrdinal?: number; text: string }): void {
  const line = parent.createDiv({ cls: `bunsho-record-line is-${rank}`, attr: { "data-record-rank": rank } });
  const head = line.createDiv({ cls: "bunsho-record-head" });
  head.createSpan({ cls: "bunsho-record-pill", text: rank === "canon" ? "Contradicts canon" : "Worth a look" });
  if (chapterOrdinal !== undefined) head.createSpan({ cls: "bunsho-fact", text: `ch${chapterOrdinal}` });
  line.createSpan({ cls: "bunsho-record-text", text });
}
