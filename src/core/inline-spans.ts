import { parseInlineEmphasis, EmphasisResult } from './inline-emphasis';
import { extractLinkDestination } from './links';

export type { EmphasisResult };

export interface CodeSpanInfo {
  outerStart: number;
  outerEnd: number;
  content: string;   // displayed content with CommonMark space-stripping applied
  tickLen: number;
}

export interface LinkInfo {
  outerStart: number;  // index of [
  outerEnd: number;    // index after )
  textStart: number;   // index after [
  textEnd: number;     // index of ]
  dest: string | undefined;
  title: string | undefined;
}

export interface InlineSpans {
  codeSpans: CodeSpanInfo[];
  links: LinkInfo[];
  emphasis: EmphasisResult;
}

export function isEscapedAt(text: string, pos: number): boolean {
  let count = 0;
  let i = pos - 1;
  while (i >= 0 && text[i] === '\\') { count++; i--; }
  return count % 2 === 1;
}

/**
 * Single left-to-right pass that detects code spans, links, and emphasis.
 *
 * Priority: whichever construct starts first wins. A backtick run that opens a
 * code span will consume its content before a [ at the same or later position
 * is processed, so code spans nested inside potential link text take precedence
 * when they start before the [.  For the common case [``code``](url) the [ is
 * first, so the link wins and its text can contain rendered inline code — which
 * is the CommonMark-compliant behaviour.
 */
export function parseInlineSpans(text: string): InlineSpans {
  const len = text.length;
  const codeSpans: CodeSpanInfo[] = [];
  const links: LinkInfo[] = [];

  // Positions inside a detected code span or link (inert for nested-link detection).
  const inert = new Uint8Array(len + 1);
  const markInert = (s: number, e: number) => {
    for (let k = s; k < e; k++) inert[k] = 1;
  };

  // Inert positions for the emphasis parser: code spans fully, but for links only
  // the delimiter characters ([ and ](url)) — not the link text — so that emphasis
  // markers inside link text (e.g. [*italic*](url)) are still processed.
  const emphasisInert = new Uint8Array(len + 1);
  const markEmphasisInert = (s: number, e: number) => {
    for (let k = s; k < e; k++) emphasisInert[k] = 1;
  };

  let i = 0;
  while (i < len) {
    if (isEscapedAt(text, i)) { i++; continue; }

    const ch = text[i];

    // ── Code span ────────────────────────────────────────────────────────────
    if (ch === '`') {
      const tickStart = i;
      while (i < len && text[i] === '`') i++;
      const tickLen = i - tickStart;

      // Find the matching closing run of exactly tickLen backticks.
      let j = i;
      while (j < len) {
        if (text[j] === '`') {
          const closeStart = j;
          while (j < len && text[j] === '`') j++;
          if (j - closeStart === tickLen) {
            let content = text.slice(i, closeStart);
            // CommonMark space-stripping: one leading/trailing space removed when
            // both are present and the content is not all spaces.
            if (
              content.length >= 2 &&
              content[0] === ' ' &&
              content[content.length - 1] === ' ' &&
              content.trim().length > 0
            ) {
              content = content.slice(1, -1);
            }
            codeSpans.push({ outerStart: tickStart, outerEnd: j, content, tickLen });
            markInert(tickStart, j);
            markEmphasisInert(tickStart, j);
            i = j;
            break;
          }
          // Mismatched-length closing run — keep searching.
        } else {
          j++;
        }
      }
      // If no close found, i already advanced past the opening ticks; continue.
      continue;
    }

    // ── Link [text](dest) ────────────────────────────────────────────────────
    if (ch === '[' && !inert[i]) {
      const linkStart = i;

      // Scan for the closing ] with bracket-depth tracking so that
      // nested [image](url) inside link text (e.g. [![badge](img)](url))
      // doesn't terminate the outer link prematurely.
      let j = i + 1;
      let textClose = -1;
      let bracketDepth = 0;
      while (j < len) {
        if (inert[j] || isEscapedAt(text, j)) { j++; continue; }
        if (text[j] === '\n') break;
        if (text[j] === '[') { bracketDepth++; j++; continue; }
        if (text[j] === ']') {
          if (bracketDepth > 0) { bracketDepth--; j++; continue; }
          textClose = j;
          break;
        }
        j++;
      }

      if (textClose !== -1 && textClose + 1 < len && text[textClose + 1] === '(') {
        // Scan for the closing ) with balanced parens.
        let k = textClose + 2;
        let depth = 1;
        while (k < len && depth > 0) {
          if (isEscapedAt(text, k)) { k++; continue; }
          if (text[k] === '\n') break;
          if (text[k] === '(') depth++;
          else if (text[k] === ')' && --depth === 0) break;
          k++;
        }
        if (depth === 0) {
          const outerEnd = k + 1;
          const textStart = linkStart + 1;
          const textEnd = textClose;
          const linkDest = extractLinkDestination(text.slice(textEnd + 2, k));
          links.push({
            outerStart: linkStart,
            outerEnd,
            textStart,
            textEnd,
            dest: linkDest?.url,
            title: linkDest?.title,
          });
          markInert(linkStart, outerEnd);
          markEmphasisInert(linkStart, textStart);
          markEmphasisInert(textEnd, outerEnd);
          i = outerEnd;
          continue;
        }
      }
    }

    i++;
  }

  const isInertFn = (idx: number) => isEscapedAt(text, idx) || emphasisInert[idx] === 1;
  const emphasis = parseInlineEmphasis(text, isInertFn);

  return { codeSpans, links, emphasis };
}
