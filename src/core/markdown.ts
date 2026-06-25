import { isEscapedAt, parseInlineSpans } from './inline-spans';

export { isEscapedAt };

export const ESCAPE_RE = /\\([\\`*_~[\]()#|+!-])/g;
export const NBSP = "\u00A0";

export function textDisplayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === '\t') {
      width += 4;
    } else {
      width += char.codePointAt(0)! > 0xff ? 2 : 1;
    }
  }
  return width;
}

export function markdownDisplayWidth(text: string): number {
  const { codeSpans, links, emphasis } = parseInlineSpans(text);
  const len = text.length;
  const skip = new Uint8Array(len);

  for (const mk of emphasis.markers) {
    for (let k = mk.start; k < mk.end; k++) skip[k] = 1;
  }
  for (const cs of codeSpans) {
    for (let k = cs.outerStart; k < cs.outerEnd; k++) skip[k] = 1;
  }
  for (const lk of links) {
    for (let k = lk.outerStart; k < lk.textStart; k++) skip[k] = 1;
    for (let k = lk.textEnd; k < lk.outerEnd; k++) skip[k] = 1;
  }

  // Skip escape backslashes (keep the escaped char itself).
  const escapeRe = new RegExp(ESCAPE_RE);
  let m: RegExpExecArray | null;
  while ((m = escapeRe.exec(text)) !== null) {
    skip[m.index] = 1;
  }

  let width = 0;
  for (let k = 0; k < len; k++) {
    if (skip[k]) continue;
    const cp = text.codePointAt(k)!;
    width += cp > 0xff ? 2 : 1;
    if (cp > 0xffff) k++; // skip low surrogate of a surrogate pair
  }

  // Add rendered widths of code span contents (backtick delimiters were skipped above).
  for (const cs of codeSpans) {
    width += textDisplayWidth(cs.content);
  }

  return width;
}
