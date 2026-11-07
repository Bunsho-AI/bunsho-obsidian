import { BunshoWordmark } from "@/atoms/BunshoWordmark";

/** The panel's top line: the Bunsho wordmark. */
export function BrandHeader(parent: HTMLElement): HTMLElement {
  const header = parent.createDiv({ cls: "bunsho-brand" });
  BunshoWordmark(header, 16);
  return header;
}
