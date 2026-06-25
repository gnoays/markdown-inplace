import { TextSpan, span } from './decoration-model';

// Inline emphasis parser using the CommonMark delimiter stack algorithm.
// Targets are * _ (emphasis/strong) and ~~ (GFM strikethrough). Single ~ (GFM) is not supported.
// Positions inside code spans, links, and escapes are excluded by isInert and not treated as markers.

interface Delim {
  char: string;       // '*' | '_' | '~'
  start: number;      // Start position of the run. Advances right as it is consumed as a closer
  length: number;     // Remaining length. Decreases as it is consumed
  origLength: number; // Original length for rule-of-three checking
  canOpen: boolean;
  canClose: boolean;
}

export interface EmphasisResult {
  markers: TextSpan[];    // Open/close marker character ranges (relative to text, 0-indexed)
  bold: TextSpan[];       // Content runs with bold only
  italic: TextSpan[];     // Italic only
  boldItalic: TextSpan[]; // Both (bold and italic)
  strike: TextSpan[];     // Strikethrough content (independent of bold/italic)
}

// ASCII punctuation ranges (from ! to ~). Used for CommonMark punctuation checks.
const ASCII_PUNCT_RE = /[!-/:-@[-`{-~]/;

function isWhitespaceChar(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

function isPunctuationChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return ASCII_PUNCT_RE.test(ch) || /\p{P}/u.test(ch);
}

export function parseInlineEmphasis(
  text: string,
  isInert: (index: number) => boolean
): EmphasisResult {
  const len = text.length;

  // 1. Collect delimiter runs
  const delims: Delim[] = [];
  let i = 0;
  while (i < len) {
    const ch = text[i];
    if ((ch === '*' || ch === '_' || ch === '~') && !isInert(i)) {
      let j = i + 1;
      while (j < len && text[j] === ch && !isInert(j)) j++;
      const runLen = j - i;

      const before = i > 0 ? text[i - 1] : undefined;
      const after = j < len ? text[j] : undefined;
      const beforeWs = isWhitespaceChar(before);
      const afterWs = isWhitespaceChar(after);
      const beforePunct = isPunctuationChar(before);
      const afterPunct = isPunctuationChar(after);

      const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
      const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);

      let canOpen: boolean;
      let canClose: boolean;
      if (ch === '_') {
        // Underlines inside words do not open or close (intraword rule)
        canOpen = leftFlanking && (!rightFlanking || beforePunct);
        canClose = rightFlanking && (!leftFlanking || afterPunct);
      } else {
        canOpen = leftFlanking;
        canClose = rightFlanking;
      }

      delims.push({ char: ch, start: i, length: runLen, origLength: runLen, canOpen, canClose });
      i = j;
    } else {
      i++;
    }
  }

  const boldArr = new Uint8Array(len);
  const italicArr = new Uint8Array(len);
  const strikeArr = new Uint8Array(len);
  const isMarker = new Uint8Array(len);
  const markers: TextSpan[] = [];

  const addMarker = (a: number, b: number) => {
    if (b <= a) return;
    markers.push(span(a, b));
    for (let k = a; k < b; k++) isMarker[k] = 1;
  };

  // 2. Process emphasis (scan closers left-to-right to match with the closest opener)
  for (let ci = 0; ci < delims.length; ci++) {
    const closer = delims[ci];
    if (!closer.canClose) continue;

    while (closer.length > 0) {
      let opener: Delim | null = null;
      let oi = ci - 1;
      for (; oi >= 0; oi--) {
        const o = delims[oi];
        if (o.length === 0 || o.char !== closer.char || !o.canOpen) continue;
        if (o.char === '~') {
          // Strikethrough supports ~~ only (requires length >= 2 for both)
          if (o.length < 2 || closer.length < 2) continue;
        } else {
          // Rule of three (conforming to commonmark.js)
          const oddMatch =
            (closer.canOpen || o.canClose) &&
            closer.origLength % 3 !== 0 &&
            (o.origLength + closer.origLength) % 3 === 0;
          if (oddMatch) continue;
        }
        opener = o;
        break;
      }
      if (!opener) break;

      const use = closer.char === '~'
        ? 2
        : (opener.length >= 2 && closer.length >= 2) ? 2 : 1;

      // Content area = right edge of opener to left edge of closer
      const contentStart = opener.start + opener.length;
      const contentEnd = closer.start;
      const flagArr = closer.char === '~' ? strikeArr : (use === 2 ? boldArr : italicArr);
      for (let k = contentStart; k < contentEnd; k++) flagArr[k] = 1;

      addMarker(opener.start + opener.length - use, opener.start + opener.length);
      addMarker(closer.start, closer.start + use);

      // Delimiters between opener and closer can no longer be matched
      for (let k = oi + 1; k < ci; k++) delims[k].length = 0;

      opener.length -= use;
      closer.start += use;
      closer.length -= use;
    }
  }

  // 3. Coalescing (folding into maximal runs with marker positions as boundaries)
  const bold: TextSpan[] = [];
  const italic: TextSpan[] = [];
  const boldItalic: TextSpan[] = [];
  const strike: TextSpan[] = [];

  let runStart = -1;
  let runCat = 0; // 1=bold, 2=italic, 3=both
  const flushEmph = (end: number) => {
    if (runStart >= 0 && runCat) {
      const s = span(runStart, end);
      if (runCat === 3) boldItalic.push(s);
      else if (runCat === 1) bold.push(s);
      else italic.push(s);
    }
    runStart = -1;
    runCat = 0;
  };
  for (let k = 0; k < len; k++) {
    if (isMarker[k]) { flushEmph(k); continue; }
    const cat = (boldArr[k] ? 1 : 0) | (italicArr[k] ? 2 : 0);
    if (cat !== runCat) {
      flushEmph(k);
      if (cat) { runStart = k; runCat = cat; }
    }
  }
  flushEmph(len);

  let sStart = -1;
  for (let k = 0; k < len; k++) {
    if (strikeArr[k] && !isMarker[k]) {
      if (sStart < 0) sStart = k;
    } else if (sStart >= 0) {
      strike.push(span(sStart, k));
      sStart = -1;
    }
  }
  if (sStart >= 0) strike.push(span(sStart, len));

  return { markers, bold, italic, boldItalic, strike };
}
