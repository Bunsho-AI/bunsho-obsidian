/**
 * The ribbon and tab icon: the wordmark's b with its four-point sparkle, drawn on a 100x100 grid. Obsidian icons are
 * single-colour (tinted with currentColor), so the full wordmark cannot be one; inside the panel the real wordmark
 * images are used (atoms/BunshoWordmark).
 */
export const BUNSHO_ICON_ID = "bunsho-mark";

const B_STEM = '<rect x="8" y="14" width="14" height="72" rx="2.5"/>';
const B_BOWL = '<path fill-rule="evenodd" d="M38 39 a23.5 23.5 0 1 1 0 47 a23.5 23.5 0 1 1 0-47 Z M38 51 a11.5 11.5 0 1 0 0 23 a11.5 11.5 0 1 0 0-23 Z"/>';
const SPARKLE = "M80 31 C81.5 43 85 46.5 97 48 C85 49.5 81.5 53 80 65 C78.5 53 75 49.5 63 48 C75 46.5 78.5 43 80 31 Z";

/** Inner SVG for Obsidian's addIcon (viewBox 0 0 100 100), all in currentColor. */
export const BUNSHO_ICON_SVG = `<g fill="currentColor">${B_STEM}${B_BOWL}<path d="${SPARKLE}"/></g>`;

