import { BunshoMark } from "@/atoms/BunshoMark";

/** The panel's top line: the Bunsho mark and name. */
export function BrandHeader(parent: HTMLElement): HTMLElement {
  const header = parent.createDiv({ cls: "bunsho-brand" });
  BunshoMark(header, 16);
  header.createSpan({ cls: "bunsho-brand-name", text: "Bunsho" });
  return header;
}
