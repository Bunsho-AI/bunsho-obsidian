/**
 * Markdown note -> the plain text Bunsho reads, plus a map from positions in that text back to the note.
 *
 * Only markup is removed (frontmatter, %%comments%%, embeds, link brackets, heading marks, emphasis marks); words
 * are never touched, so this is language-agnostic. Rule lines stay: the engine reads a line with no letter or digit
 * as a scene break, by shape. It reads a page as its non-empty lines, so a paragraph must be one line of the note.
 */

interface Segment { out: number; src: number; len: number }

export interface ProjectedHeading {
  /** Offset of the heading's text in `Projection.text`. */
  offset: number;
  /** 1 is the highest level. */
  level: number;
}

export interface Projection {
  text: string;
  /** The note's headings, by the markup only. */
  headings: ProjectedHeading[];
  /** Offset in `text` -> offset of the same character in the note (for the start of a range). */
  toSource(offset: number): number;
  /** Offset in `text` -> offset in the note just after the last character of a range ending there. */
  toSourceEnd(offset: number): number;
  /** Offset in the note -> offset in `text`: a cursor inside removed markup counts as the text that follows it. */
  fromSource(offset: number): number;
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
/** A line YAML frontmatter can hold: blank, a comment, a key, a list item or an indented continuation. */
const YAML_LINE = /^(?:\s*$|#|[^\s:][^:]*:(?:\s|$)|\s+\S|-\s)/u;

/** Where the note's text starts. A note opening on a --- scene break, with prose before the next rule, has no frontmatter. */
function frontmatterEnd(raw: string): number {
  const match = FRONTMATTER.exec(raw);
  if (!match) return 0;
  return (match[1] ?? "").split(/\r?\n/u).every((line) => YAML_LINE.test(line)) ? match[0].length : 0;
}

// Alternatives are tried in order at each position. Groups: 1 wikilink target, 2 wikilink alias, 3 markdown link text,
// 4/5 star emphasis marks/inner, 6/7 underscore emphasis marks/inner. Underscores need word boundaries (snake_case
// stays); stars do not (CJK has no spaces).
const TOKEN = new RegExp([
  "%%[\\s\\S]*?%%", // comment
  "<!--[\\s\\S]*?-->", // html comment
  "!\\[\\[[^\\]\\n]*\\]\\]", // embed
  "\\[\\[([^\\]|\\n]*)(?:\\|([^\\]\\n]*))?\\]\\]", // wikilink
  "(?<!!)\\[([^\\]\\n]+)\\]\\([^)\\n]*\\)", // markdown link: text (group 5)
  "!\\[[^\\]\\n]*\\]\\([^)\\n]*\\)", // markdown image
  "^[ \\t]*(?:-{3,}|\\*{3,}|_{3,})[ \\t]*$", // rule line, kept as written: the engine's scene break
  "^#{1,6}[ \\t]+", // heading mark
  "(\\*{1,3})(?=\\S)([^\\n]*?\\S)\\4", // star emphasis
  "(?<![\\p{L}\\p{N}])(_{1,3})(?=\\S)([^\\n]*?\\S)\\6(?![\\p{L}\\p{N}])", // underscore emphasis
].join("|"), "gmu");

export function projectMarkdown(raw: string): Projection {
  const segments: Segment[] = [];
  const headings: ProjectedHeading[] = [];
  let out = "";
  const emit = (text: string, src: number) => {
    if (!text) return;
    segments.push({ out: out.length, src, len: text.length });
    out += text;
  };

  let pos = frontmatterEnd(raw);
  TOKEN.lastIndex = pos;
  for (let match = TOKEN.exec(raw); match; match = TOKEN.exec(raw)) {
    const whole = match[0];
    if (whole.length === 0) { TOKEN.lastIndex++; continue; }
    emit(raw.slice(pos, match.index), pos);
    if (/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/u.test(whole)) {
      emit(whole, match.index);
    } else if (whole.startsWith("#")) {
      headings.push({ offset: out.length, level: whole.trimEnd().length });
    } else if (whole.startsWith("[[")) {
      const target = match[1] ?? "";
      const alias = match[2];
      if (alias !== undefined) emit(alias, match.index + 2 + target.length + 1);
      else {
        // [[Note#Heading]] and [[Note#^block]] read as "Note"; a same-note [[#Heading]] reads as "Heading".
        const hash = target.indexOf("#");
        if (hash > 0) emit(target.slice(0, hash), match.index + 2);
        else if (hash === 0) { const heading = target.replace(/^#\^?/u, ""); emit(heading, match.index + 2 + target.length - heading.length); }
        else emit(target, match.index + 2);
      }
    } else if (match[3] !== undefined) {
      emit(match[3], match.index + 1);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      emit(match[5], match.index + match[4].length);
    } else if (match[6] !== undefined && match[7] !== undefined) {
      emit(match[7], match.index + match[6].length);
    }
    pos = match.index + whole.length; // comments, embeds and heading marks emit nothing
  }
  emit(raw.slice(pos), pos);

  return {
    text: out,
    headings,
    toSource(offset) {
      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i];
        if (offset >= s.out) return s.src + Math.min(offset - s.out, s.len);
      }
      return 0;
    },
    toSourceEnd(offset) {
      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i];
        if (offset > s.out) return s.src + Math.min(offset - s.out, s.len);
      }
      return segments[0]?.src ?? 0;
    },
    fromSource(offset) {
      for (const s of segments) {
        if (offset < s.src) return s.out;
        if (offset < s.src + s.len) return s.out + (offset - s.src);
      }
      return out.length;
    },
  };
}
