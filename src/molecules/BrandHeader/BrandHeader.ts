import { BunshoWordmark } from "@/atoms/BunshoWordmark";
import { Fact } from "@/atoms/Fact";

/** The panel's top line, always in view: the Bunsho wordmark and, when known, the plan and the balance. */
export function BrandHeader(parent: HTMLElement, account: string | null = null): HTMLElement {
  const header = parent.createDiv({ cls: "bunsho-brand" });
  BunshoWordmark(header, 16);
  if (account) Fact(header, account, "bunsho-account");
  return header;
}
