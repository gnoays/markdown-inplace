import { CommentBlockState, CommentLine, CommentSyntax, TextDocumentLike } from './types';

type MarkerMatch = {
  index: number;
  marker: string;
};

type BlockMarkerMatch = {
  index: number;
  marker: [string, string];
};

function findNextMarker(text: string, markers: string[] | undefined, from: number): MarkerMatch | undefined {
  let best: MarkerMatch | undefined;
  for (const marker of markers ?? []) {
    const index = text.indexOf(marker, from);
    if (index === -1) continue;

    if (!best || index < best.index || (index === best.index && marker.length > best.marker.length)) {
      best = { index, marker };
    }
  }
  return best;
}

function findNextBlockMarker(
  text: string,
  markers: Array<[string, string]> | undefined,
  from: number
): BlockMarkerMatch | undefined {
  let best: BlockMarkerMatch | undefined;
  for (const marker of markers ?? []) {
    const index = text.indexOf(marker[0], from);
    if (index === -1) continue;

    if (!best || index < best.index || (index === best.index && marker[0].length > best.marker[0].length)) {
      best = { index, marker };
    }
  }
  return best;
}

function findContentStartAfterMarker(text: string, markerEnd: number, repeatChar: string, blockClose?: string): number {
  let i = markerEnd;
  while (i < text.length) {
    if (blockClose && text.startsWith(blockClose, i)) break;
    const ch = text[i];
    if (ch !== repeatChar && ch !== '!') break;
    i++;
  }
  if (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
    return i + 1;
  }
  return markerEnd;
}

const BLOCK_DECORATION_PREFIX_RE = /^[ \t]*\*[ \t]?/;

function stripBlockDecoration(lines: CommentLine[], from: number, to: number): void {
  if (to - from < 2) return;

  let hasDecorated = false;
  for (let i = from; i < to; i++) {
    if (lines[i].text.trim() === '') continue;
    if (!BLOCK_DECORATION_PREFIX_RE.test(lines[i].text)) return;
    hasDecorated = true;
  }
  if (!hasDecorated) return;

  for (let i = from; i < to; i++) {
    const match = BLOCK_DECORATION_PREFIX_RE.exec(lines[i].text);
    if (!match) continue;
    lines[i] = {
      start: lines[i].start + match[0].length,
      text: lines[i].text.slice(match[0].length),
    };
  }
}

function cloneBlockState(state: CommentBlockState): CommentBlockState {
  return { inBlock: state.inBlock, activeBlockClose: state.activeBlockClose };
}

function advanceBlockState(lineText: string, syntax: CommentSyntax, state: CommentBlockState): CommentBlockState {
  const next = cloneBlockState(state);
  let pos = 0;

  while (pos <= lineText.length) {
    if (next.inBlock) {
      const closeIdx = lineText.indexOf(next.activeBlockClose, pos);
      if (closeIdx === -1) break;
      next.inBlock = false;
      pos = closeIdx + next.activeBlockClose.length;
      next.activeBlockClose = '';
      continue;
    }

    const blockMatch = findNextBlockMarker(lineText, syntax.block, pos);
    const lineMatch = findNextMarker(lineText, syntax.line, pos);
    if (!blockMatch && !lineMatch) break;

    const useLine = !!lineMatch && (!blockMatch || lineMatch.index < blockMatch.index);
    if (useLine) break;
    if (!blockMatch) break;

    const [blockOpen, blockClose] = blockMatch.marker;
    const blockMarkerEnd = blockMatch.index + blockOpen.length;
    const closeIdx = lineText.indexOf(blockClose, blockMarkerEnd);
    if (closeIdx === -1) {
      next.inBlock = true;
      next.activeBlockClose = blockClose;
      break;
    }

    pos = closeIdx + blockClose.length;
  }

  return next;
}

export function getCommentBlockStates(
  doc: Pick<TextDocumentLike, 'lineAt'>,
  syntax: CommentSyntax,
  lineCount: number
): CommentBlockState[] {
  const states: CommentBlockState[] = [];
  let state: CommentBlockState = { inBlock: false, activeBlockClose: '' };

  for (let lineNo = 0; lineNo < lineCount; lineNo++) {
    states.push(cloneBlockState(state));
    state = advanceBlockState(doc.lineAt(lineNo).text, syntax, state);
  }
  states.push(cloneBlockState(state));
  return states;
}

export function extractAllLines(doc: TextDocumentLike, startLine: number, endLine: number): CommentLine[] {
  const lines: CommentLine[] = [];
  for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
    const lineText = doc.lineAt(lineNo).text;
    const lineOffset = doc.offsetAt({ line: lineNo, character: 0 });
    lines.push({ start: lineOffset, text: lineText });
  }
  return lines;
}

export function extractCommentLinesFromDocument(
  doc: TextDocumentLike,
  syntax: CommentSyntax,
  startLine: number,
  endLine: number,
  initialBlockState: CommentBlockState = { inBlock: false, activeBlockClose: '' }
): CommentLine[] {
  const lines: CommentLine[] = [];

  if (!syntax.line && !syntax.block) {
    return lines;
  }

  let inBlock = initialBlockState.inBlock;
  let activeBlockClose = initialBlockState.activeBlockClose;
  let blockStart = inBlock ? 0 : -1;

  for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
    const lineText = doc.lineAt(lineNo).text;
    const lineOffset = doc.offsetAt({ line: lineNo, character: 0 });
    let pos = 0;

    while (pos <= lineText.length) {
      if (inBlock) {
        const closeIdx = lineText.indexOf(activeBlockClose, pos);
        const contentEnd = closeIdx === -1 ? lineText.length : closeIdx;
        lines.push({ start: lineOffset + pos, text: lineText.slice(pos, contentEnd) });

        if (closeIdx === -1) {
          break;
        }

        inBlock = false;
        pos = closeIdx + activeBlockClose.length;
        activeBlockClose = '';
        stripBlockDecoration(lines, blockStart, lines.length);
        blockStart = -1;
        continue;
      }

      const blockMatch = findNextBlockMarker(lineText, syntax.block, pos);
      const lineMatch = findNextMarker(lineText, syntax.line, pos);

      if (!blockMatch && !lineMatch) {
        break;
      }

      const useLine = !!lineMatch && (!blockMatch || lineMatch.index < blockMatch.index);

      if (useLine && lineMatch) {
        const markerEnd = lineMatch.index + lineMatch.marker.length;
        const repeatChar = lineMatch.marker[lineMatch.marker.length - 1];
        const contentStart = findContentStartAfterMarker(lineText, markerEnd, repeatChar);
        lines.push({ start: lineOffset + contentStart, text: lineText.slice(contentStart) });
        break;
      }

      if (!blockMatch) {
        break;
      }

      const [blockOpen, blockClose] = blockMatch.marker;
      const blockMarkerEnd = blockMatch.index + blockOpen.length;
      const blockRepeatChar = blockOpen[blockOpen.length - 1];
      const contentStart = findContentStartAfterMarker(lineText, blockMarkerEnd, blockRepeatChar, blockClose);
      const closeIdx = lineText.indexOf(blockClose, contentStart);
      const contentEnd = closeIdx === -1 ? lineText.length : closeIdx;
      blockStart = lines.length;
      lines.push({ start: lineOffset + contentStart, text: lineText.slice(contentStart, contentEnd) });

      if (closeIdx === -1) {
        inBlock = true;
        activeBlockClose = blockClose;
        break;
      }

      stripBlockDecoration(lines, blockStart, lines.length);
      blockStart = -1;
      pos = closeIdx + blockClose.length;
    }
  }

  if (inBlock && blockStart >= 0) {
    stripBlockDecoration(lines, blockStart, lines.length);
  }

  return lines;
}