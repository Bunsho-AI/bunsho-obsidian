/**
 * Markdown note -> the plain text Bunsho reads, plus a map from positions in that text back to the note.
 *
 * Only markup is removed (frontmatter, %%comments%%, embeds, link brackets, heading marks, emphasis marks,
 * scene-break rules); words are never touched, so this is language-agnostic. The engine reads a page as
 * its non-empty lines, so a paragraph must be one line of the note (the structure Bunsho asks for).
 */

interface Segment { out: number; src: number; len: number }

export interface Projection {
  text: string;
  /** Offset in `text` -> offset of the same character in the note (for the start of a range). */
  toSource(offset: number): number;
  /** Offset in `text` -> offset in the note just after the last character of a range ending there. */
  toSourceEnd(offset: number): number;
}

const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

// Alternatives are tried in order at each position. Groups: 1 link target, 2 link alias, 3/4 star emphasis marks/inner,
// 5/6 underscore emphasis marks/inner. Underscores need word boundaries (snake_case stays); stars do not (CJK has no spaces).
const TOKEN = new RegExp([
  "%%[\\s\\S]*?%%", // comment
  "!\\[\\[[^\\]\\n]*\\]\\]", // embed
  "\\[\\[([^\\]|\\n]*)(?:\\|([^\\]\\n]*))?\\]\\]", // wikilink
  "^[ \\t]*(?:-{3,}|\\*{3,}|_{3,})[ \\t]*$", // scene-break rule line
  "^#{1,6}[ \\t]+", // heading mark
  "(\\*{1,3})(?=\\S)([^\\n]*?\\S)\\3", // star emphasis
  "(?<![\\p{L}\\p{N}])(_{1,3})(?=\\S)([^\\n]*?\\S)\\5(?![\\p{L}\\p{N}])", // underscore emphasis
].join("|"), "gmu");

export function projectMarkdown(raw: string): Projection {
  const segments: Segment[] = [];
  let out = "";
  const emit = (text: string, src: number) => {
    if (!text) return;
    segments.push({ out: out.length, src, len: text.length });
    out += text;
  };

  let pos = FRONTMATTER.exec(raw)?.[0].length ?? 0;
  TOKEN.lastIndex = pos;
  for (let match = TOKEN.exec(raw); match; match = TOKEN.exec(raw)) {
    const whole = match[0];
    if (whole.length === 0) { TOKEN.lastIndex++; continue; }
    emit(raw.slice(pos, match.index), pos);
    if (whole.startsWith("[[")) {
      const target = match[1] ?? "";
      const alias = match[2];
      if (alias !== undefined) emit(alias, match.index + 2 + target.length + 1);
      else emit(target, match.index + 2);
    } else if (match[3] !== undefined && match[4] !== undefined) {
      emit(match[4], match.index + match[3].length);
    } else if (match[5] !== undefined && match[6] !== undefined) {
      emit(match[6], match.index + match[5].length);
    }
    pos = match.index + whole.length; // comments, embeds, rules and heading marks emit nothing
  }
  emit(raw.slice(pos), pos);

  return {
    text: out,
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
  };
}
