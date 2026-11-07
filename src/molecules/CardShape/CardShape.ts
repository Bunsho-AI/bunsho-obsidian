/** The card's shape, pulsing while the plan is on its way. Never at rest: a faint static shape reads as a stuck skeleton. */
export function CardShape(parent: HTMLElement): void {
  const card = parent.createDiv({ cls: "bunsho-scene-card bunsho-card-shape", attr: { "aria-hidden": "true" } });
  const head = card.createDiv({ cls: "bunsho-card-shape-head" });
  for (const cls of ["is-title", "is-long", "is-mid"]) head.createSpan({ cls: `bunsho-card-shape-bar is-reading ${cls}` });
  const rows = card.createDiv({ cls: "bunsho-card-shape-rows" });
  for (const n of [1, 2, 3]) {
    const row = rows.createDiv({ cls: "bunsho-card-shape-row" });
    row.createSpan({ cls: "bunsho-fact is-reading", text: String(n) });
    row.createSpan({ cls: "bunsho-card-shape-rule is-reading" });
  }
}
