/** Machine fact in the mono "fact" type role: counts, coordinates, status. */
export function Fact(parent: HTMLElement, text: string, extraClass = ""): HTMLElement {
  return parent.createDiv({ cls: `bunsho-fact${extraClass ? ` ${extraClass}` : ""}`, text });
}
