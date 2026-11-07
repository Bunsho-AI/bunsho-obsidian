import { formatNumber } from "@/utils/format";

/** Our fault, said plainly; the charge stated only as the engine reported it. */
export function SceneFailureLine(parent: HTMLElement, { message, charged }: { message: string; charged: number | null }): void {
  const line = parent.createDiv({ cls: "bunsho-director-line", attr: { role: "status" } });
  line.appendText(`${message} `);
  if (charged === 0) line.createSpan({ cls: "bunsho-director-strong", text: "Nothing was charged." });
  else if (charged !== null) line.createSpan({ cls: "bunsho-director-strong", text: `${formatNumber(charged)} credits were charged.` });
}
