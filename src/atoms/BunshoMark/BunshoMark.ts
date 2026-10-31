import { BUNSHO_MARK_SVG } from "@/assets/logo";

/** The Bunsho mark (b + amber sparkle) at a given pixel size. */
export function BunshoMark(parent: HTMLElement, size: number): HTMLElement {
  const holder = parent.createSpan({ cls: "bunsho-mark" });
  holder.style.setProperty("--bunsho-mark-size", `${size}px`);
  // Static markup from our own constant, never from data.
  holder.appendChild(new DOMParser().parseFromString(BUNSHO_MARK_SVG, "image/svg+xml").documentElement);
  return holder;
}
