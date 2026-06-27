import { parseInlineEmphasis, EmphasisResult } from './inline-emphasis';
import { extractLinkDestination } from './links';

export type { EmphasisResult };

export interface CodeSpanInfo {
  outerStart: number;
  outerEnd: number;
  content: string;   // displayed content with CommonMark space-stripping applied
  tickLen: number;
}

export interface LinkImage {
  src: string;
  srcTitle?: string;
  altStart: number;  // position of alt text start in line text (after ![)
  altEnd: number;    // position of alt text end in line text
}

export interface LinkInfo {
  outerStart: number;  // index of [ (or ! for an image entry)
  outerEnd: number;    // index after )
  textStart: number;   // index after [
  textEnd: number;     // index of ]
  dest: string | undefined;  // navigation target; undefined for image entries
  title: string | undefined;
  image?: LinkImage;   // present when this entry is an image ![alt](src)
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
 * Detects code spans, links, images, and emphasis in a single line.
 *
 * The scan is recursive: link text is re-scanned for code spans and images so
 * that `[a `code` b](url)` and `[*x* ![alt](src)](url)` render their inner
 * constructs.  Links are not detected inside link text (allowLinks=false), so a
 * nested link `[aa[bb](cc)](dd)` keeps the inner `[bb](cc)` as literal text and
 * makes the whole span point at `dd`.  Emphasis runs as a separate whole-line
 * pass afterwards (link/image delimiters are inert, their text is not).
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

  // Inert positions for the emphasis parser: code spans fully, but for links/images
  // only the delimiter characters ([ ](url)) — not the text — so that emphasis
  // markers inside link text (e.g. [*italic*](url)) are still processed.
  const emphasisInert = new Uint8Array(len + 1);
  const markEmphasisInert = (s: number, e: number) => {
    for (let k = s; k < e; k++) emphasisInert[k] = 1;
  };

  // Scan [lo, hi) for code spans, images, and (when allowLinks) links. Shared
  // state (codeSpans/links/inert masks) is mutated; link text is recursed into
  // with allowLinks=false.
  const scanRange = (lo: number, hi: number, allowLinks: boolean) => {
    let i = lo;
    while (i < hi) {
      if (isEscapedAt(text, i)) { i++; continue; }

      const ch = text[i];

      // ── Code span ──────────────────────────────────────────────────────────
      if (ch === '`') {
        const tickStart = i;
        while (i < hi && text[i] === '`') i++;
        const tickLen = i - tickStart;

        // Find the matching closing run of exactly tickLen backticks.
        let j = i;
        while (j < hi) {
          if (text[j] === '`') {
            const closeStart = j;
            while (j < hi && text[j] === '`') j++;
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

      // ── Link [text](dest) / Image ![alt](src) ─────────────────────────────
      if (ch === '[' && !inert[i]) {
        const isImage = i > 0 && text[i - 1] === '!' && !isEscapedAt(text, i - 1) && !inert[i - 1];
        // Real links are suppressed inside link text; images are always honored.
        if (isImage || allowLinks) {
          const linkStart = i;

          // Scan for the closing ] with bracket-depth tracking so that
          // nested [..](..) inside link text (e.g. [![badge](img)](url))
          // doesn't terminate the outer link prematurely.
          let j = i + 1;
          let textClose = -1;
          let bracketDepth = 0;
          while (j < hi) {
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

          if (textClose !== -1 && textClose + 1 < hi && text[textClose + 1] === '(') {
            // Scan for the closing ) with balanced parens.
            let k = textClose + 2;
            let depth = 1;
            while (k < hi && depth > 0) {
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

              if (isImage) {
                const imageOuterStart = linkStart - 1;  // include the !
                const image: LinkImage | undefined = linkDest?.url ? {
                  src: linkDest.url,
                  srcTitle: linkDest.title,
                  altStart: textStart,
                  altEnd: textEnd,
                } : undefined;
                links.push({
                  outerStart: imageOuterStart,
                  outerEnd,
                  textStart,
                  textEnd,
                  dest: undefined,
                  title: undefined,
                  image,
                });
                markInert(imageOuterStart, outerEnd);
                markEmphasisInert(imageOuterStart, textStart);
                markEmphasisInert(textEnd, outerEnd);
              } else {
                // Recurse into link text for inner code spans and images before
                // recording the link, so the inner constructs are registered and
                // their delimiters marked inert. Nested real links are suppressed.
                scanRange(textStart, textEnd, false);
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
              }
              i = outerEnd;
              continue;
            }
          }
        }
      }

      i++;
    }
  };

  scanRange(0, len, true);

  const isInertFn = (idx: number) => isEscapedAt(text, idx) || emphasisInert[idx] === 1;
  const emphasis = parseInlineEmphasis(text, isInertFn);

  return { codeSpans, links, emphasis };
}
