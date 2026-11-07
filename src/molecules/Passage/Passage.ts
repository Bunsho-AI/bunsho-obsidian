import { Fact } from "@/atoms/Fact";

/** One quoted passage with its coordinate; clicking (or Enter/Space) selects it in the note. */
export interface PassageProps { quote: string; coordinate: string; onGo: () => void }

export function Passage(parent: HTMLElement, { quote, coordinate, onGo }: PassageProps): HTMLElement {
  const block = parent.createDiv({ cls: "bunsho-passage", attr: { role: "button", tabindex: "0", "aria-label": "Go to passage" } });
  block.createDiv({ cls: "bunsho-quote", text: quote });
  Fact(block, coordinate, "bunsho-coords");
  block.onclick = onGo;
  block.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onGo(); } };
  return block;
}
