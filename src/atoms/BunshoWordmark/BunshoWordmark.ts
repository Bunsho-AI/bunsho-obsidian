import wordmarkDark from "@/assets/wordmark-dark.png";
import wordmarkWhite from "@/assets/wordmark-white.png";

/**
 * The "bunsho✦" wordmark, as on the desktop app: dark letters on light themes, the white mark on dark themes.
 * Both images are cropped to their ink, so `height` is the height of the letters plus the star. The theme picks
 * which image shows (styles.css), so switching themes needs no re-render.
 */
export function BunshoWordmark(parent: HTMLElement, height: number): HTMLElement {
  const holder = parent.createSpan({ cls: "bunsho-wordmark", attr: { role: "img", "aria-label": "Bunsho" } });
  holder.style.setProperty("--bunsho-wordmark-height", `${height}px`);
  holder.createEl("img", { cls: "bunsho-wordmark-light", attr: { src: wordmarkDark, alt: "", draggable: "false" } });
  holder.createEl("img", { cls: "bunsho-wordmark-dark", attr: { src: wordmarkWhite, alt: "", draggable: "false" } });
  return holder;
}
