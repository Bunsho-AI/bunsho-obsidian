import { price, type DraftPassage } from "@/helpers/director/sceneView";

/**
 * The whole scene on a page sheet, in the panel, because it is about to be the page. Read-only before Keep, each passage opening with its beat number. Rewrite this beat redoes only that
 * passage. The desktop shows the control on hover; here each passage carries it, with its price.
 */
export interface SceneDraftProps {
  passages: DraftPassage[];
  litBeat: number | null;
  rewritePrice: number | null;
  rewritingBeat: number | null;
  onHoverBeat: (order: number | null) => void;
  onRewrite?: (passage: DraftPassage) => void;
  /** Draws the note slot under the passage it is open for. */
  slot?: { beatId: string; draw: (parent: HTMLElement) => void } | null;
}

export function SceneDraft(parent: HTMLElement, props: SceneDraftProps): void {
  const sheet = parent.createDiv({ cls: "bunsho-draft-sheet", attr: { "aria-label": "The draft, not yet in the chapter" } });
  const label = price(props.rewritePrice);
  for (const passage of props.passages) {
    const rewriting = passage.beatOrder === props.rewritingBeat;
    const block = sheet.createDiv({ cls: `bunsho-draft-passage${passage.beatOrder === props.litBeat ? " is-lit" : ""}${rewriting ? " is-reading" : ""}`, attr: { "data-passage": String(passage.beatOrder) } });
    block.onmouseenter = () => props.onHoverBeat(passage.beatOrder);
    block.onmouseleave = () => props.onHoverBeat(null);
    block.createSpan({ cls: "bunsho-fact bunsho-draft-n", text: String(passage.beatOrder) });
    for (const text of passage.paragraphs) block.createEl("p", { text });
    if (props.slot?.beatId === passage.beatId) { props.slot.draw(block); continue; }
    if (!props.onRewrite || rewriting || !label) continue;
    const { onRewrite } = props;
    const rewrite = block.createEl("button", { cls: "bunsho-pen is-accent", attr: { "data-focus-key": `rewrite:${passage.beatId}` } });
    rewrite.createSpan({ text: "Rewrite this beat" });
    rewrite.createSpan({ cls: "bunsho-fact", text: label });
    rewrite.onclick = () => onRewrite(passage);
  }
}
