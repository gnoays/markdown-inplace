import { SyntaxCategory, highlightFenceLines } from '../highlight';
import { CommentLine, TextDocumentLike } from './types';
import { TableRow, collectTableRows } from './table';
import { ESCAPE_RE, NBSP, markdownDisplayWidth, textDisplayWidth } from './markdown';
import { parseInlineSpans } from './inline-spans';
import {
  DecorationBuckets,
  EditableLineRange,
  ScanOptions,
  TextSpan,
  span,
  themeColor,
} from './decoration-model';

function touchesEditableLine(
  doc: Pick<TextDocumentLike, 'positionAt'>,
  absStart: number,
  absEnd: number,
  editableLines: readonly EditableLineRange[]
): boolean {
  const startLine = doc.positionAt(absStart).line;
  const endLine = doc.positionAt(absEnd).line;

  return editableLines.some((selection) => (
    endLine >= selection.startLine && startLine <= selection.endLine
  ));
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

export function scanComments(
  lines: CommentLine[],
  doc: Pick<TextDocumentLike, 'positionAt'>,
  buckets: DecorationBuckets,
  editableLines: readonly EditableLineRange[],
  options: ScanOptions
): void {
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let fenceInfo = '';
  let lastDocLine = -1;
  let fenceLines: CommentLine[] = [];

  const flushFenceLines = () => {
    if (fenceLines.length === 0) return;

    if (options.highlightFencedCode) {
      for (const highlight of highlightFenceLines(fenceInfo, fenceLines)) {
        buckets.syntaxRanges[highlight.category].push(span(highlight.start, highlight.end));
      }
    }

    const maxLen = Math.max(...fenceLines.map((line) => textDisplayWidth(line.text)));
    for (const fenceLine of fenceLines) {
      const lineEnd = fenceLine.start + fenceLine.text.length;
      const fill = Math.max(0, maxLen - textDisplayWidth(fenceLine.text));
      buckets.fenceCodeRanges.push({
        range: span(fenceLine.start, lineEnd),
        renderOptions: (options.renderFencedCodeBackground && fill > 0)
          ? {
            after: {
              contentText: NBSP.repeat(fill),
              backgroundColor: themeColor('markdownInplace.codeBlockBackground'),
            },
          }
          : undefined,
      });
    }
    fenceLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const docLine = doc.positionAt(line.start).line;

    if (inFence && docLine !== lastDocLine + 1) {
      flushFenceLines();
      inFence = false;
    }
    lastDocLine = docLine;

    if (options.renderFencedCode) {
      const fenceMatch = FENCE_RE.exec(line.text);

      if (!inFence && fenceMatch) {
        inFence = true;
        fenceChar = fenceMatch[2][0];
        fenceLen = fenceMatch[2].length;
        fenceInfo = fenceMatch[3].trim();
        continue;
      }

      if (inFence) {
        if (fenceMatch && fenceMatch[2][0] === fenceChar && fenceMatch[2].length >= fenceLen && fenceMatch[3].trim() === '') {
          flushFenceLines();
          inFence = false;
        } else {
          fenceLines.push(line);
        }
        continue;
      }
    }

    if (options.renderTables) {
      const tableRows = collectTableRows(lines, i, doc);
      if (tableRows) {
        renderTableRows(tableRows, doc, buckets, editableLines, options);
        i += tableRows.length - 1;
        continue;
      }
    }

    scanLineMarkdown(line, doc, buckets, editableLines, options);
  }

  flushFenceLines();
}

type TableAlignment = 'left' | 'right' | 'center';

function alignmentOf(cellText: string): TableAlignment {
  const trimmed = cellText.trim();
  const left = trimmed.startsWith(':');
  const right = trimmed.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

function renderTableRows(
  rows: TableRow[],
  doc: Pick<TextDocumentLike, 'positionAt'>,
  buckets: DecorationBuckets,
  editableLines: readonly EditableLineRange[],
  options: ScanOptions
): void {
  const separatorRow = rows.find((row) => row.isSeparator);
  const alignments = separatorRow?.cells.map((cell) => alignmentOf(cell.text)) ?? [];

  const leadingGapOf = (row: TableRow, index: number) => {
    const pipeBefore = row.pipeOffsets[index];
    return row.cells[index].contentStart - (pipeBefore + 1);
  };

  const cellDisplayWidth = (text: string) =>
    options.hideMarkers ? markdownDisplayWidth(text) : textDisplayWidth(text);

  const columnSpans: number[] = [];
  for (const row of rows) {
    row.cells.forEach((cell, index) => {
      const columnSpan = row.isSeparator
        ? leadingGapOf(row, index) + cell.text.trim().length
        : cellDisplayWidth(cell.text.trim()) + 2;
      columnSpans[index] = Math.max(columnSpans[index] ?? 0, columnSpan);
    });
  }

  const isTableEditable = rows.some((row) => {
    const lineEnd = row.line.start + row.line.text.length;
    return touchesEditableLine(doc, row.line.start, lineEnd, editableLines);
  });

  const hideExistingGap = (row: TableRow, gapStartOffset: number, gapEndOffset: number) => {
    const gapStart = row.line.start + gapStartOffset;
    const gapEnd = row.line.start + gapEndOffset;
    if (gapEnd > gapStart) {
      buckets.tableTrailingWhitespaceRanges.push(span(gapStart, gapEnd));
    }
  };

  rows.forEach((row, rowIndex) => {
    const lineEnd = row.line.start + row.line.text.length;

    if (!row.isSeparator) {
      scanLineMarkdown(row.line, doc, buckets, editableLines, options);
    }

    if (isTableEditable) return;

    for (const pipeOffset of row.pipeOffsets) {
      buckets.tablePipeRanges.push(span(row.line.start + pipeOffset, row.line.start + pipeOffset + 1));
    }

    if (row.isSeparator) {
      buckets.tableSeparatorRanges.push(span(row.line.start, lineEnd));

      row.cells.forEach((cell, index) => {
        const width = cell.text.length;
        const columnSpan = leadingGapOf(row, index) + width;
        const fill = Math.max(0, (columnSpans[index] ?? columnSpan) - columnSpan);
        hideExistingGap(row, cell.contentEnd, cell.rawEnd);
        if (fill === 0) return;

        const padOffset = cell.text.endsWith(':') ? cell.contentEnd - 1 : cell.contentEnd;
        const padAt = row.line.start + padOffset;
        buckets.tablePaddingOptions.push({
          range: span(padAt, padAt),
          renderOptions: {
            after: { contentText: '-'.repeat(fill), color: themeColor('descriptionForeground') },
          },
        });
      });
      return;
    }

    if (rowIndex === 0) {
      for (const cell of row.cells) {
        buckets.tableHeaderRanges.push(span(row.line.start + cell.contentStart, row.line.start + cell.contentEnd));
      }
    }

    row.cells.forEach((cell, index) => {
      const width = cellDisplayWidth(cell.text.trim());
      const columnSpan = columnSpans[index] ?? width + 2;
      const slack = Math.max(2, columnSpan - width);
      let leadingPad: number;
      let trailingPad: number;
      switch (alignments[index]) {
        case 'right':
          trailingPad = 1;
          leadingPad = slack - trailingPad;
          break;
        case 'center':
          leadingPad = Math.floor(slack / 2);
          trailingPad = slack - leadingPad;
          break;
        default:
          leadingPad = 1;
          trailingPad = slack - leadingPad;
          break;
      }

      const pipeBefore = row.pipeOffsets[index];
      hideExistingGap(row, pipeBefore + 1, cell.contentStart);
      hideExistingGap(row, cell.contentEnd, cell.rawEnd);

      const leadingPadAt = row.line.start + pipeBefore + 1;
      buckets.tablePaddingOptions.push({
        range: span(leadingPadAt, leadingPadAt),
        renderOptions: { after: { contentText: NBSP.repeat(leadingPad) } },
      });

      const trailingPadAt = row.line.start + cell.contentEnd;
      buckets.tablePaddingOptions.push({
        range: span(trailingPadAt, trailingPadAt),
        renderOptions: { after: { contentText: NBSP.repeat(trailingPad) } },
      });
    });
  });
}

const LIST_RE = /^(\s*)([-*+])(\s+)(?:(\[[ xX]\])(\s+))?(.*)$/;
const HORIZONTAL_RULE_RE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCKQUOTE_RE = /^([ \t]*)((?:>[ \t]?)+)/;

function scanBlockquote(
  line: CommentLine,
  doc: Pick<TextDocumentLike, 'positionAt'>,
  buckets: DecorationBuckets,
  editableLines: readonly EditableLineRange[],
  options: ScanOptions
): void {
  if (!options.renderBlockquotes || !options.hideMarkers) return;

  const m = BLOCKQUOTE_RE.exec(line.text);
  if (!m) return;

  const [, indent, markers] = m;
  const depth = (markers.match(/>/g) ?? []).length;

  const markerStart = line.start + indent.length;
  const markerEnd = markerStart + markers.length;

  if (touchesEditableLine(doc, markerStart, markerEnd, editableLines)) return;

  buckets.hiddenRanges.push(span(markerStart, markerEnd));
  buckets.blockquoteOptions.push({
    range: span(markerStart, markerStart),
    renderOptions: { before: { contentText: '┃ '.repeat(depth) } },
  });
}

function scanListMarker(
  line: CommentLine,
  doc: Pick<TextDocumentLike, 'positionAt'>,
  buckets: DecorationBuckets,
  editableLines: readonly EditableLineRange[],
  options: ScanOptions
): void {
  if (!options.renderLists || !options.hideMarkers) return;

  const m = LIST_RE.exec(line.text);
  if (!m) return;

  const [, indent, bullet, bulletGap, checkbox, checkboxGap] = m;

  let offset = indent.length;
  const bulletStart = offset;
  offset += bullet.length;
  offset += bulletGap.length;

  let glyph = '•';

  if (checkbox) {
    const checked = checkbox[1].toLowerCase() === 'x';
    glyph = checked ? '☑' : '☐';
    offset += checkbox.length;
    offset += checkboxGap.length;
  }

  const replaceStart = line.start + bulletStart;
  const replaceEnd = line.start + offset;

  if (!touchesEditableLine(doc, replaceStart, replaceEnd, editableLines)) {
    buckets.listGlyphOptions.push({
      range: span(replaceStart, replaceEnd),
      renderOptions: { before: { contentText: `${glyph} ` } },
    });
  }
}

function scanHorizontalRule(
  line: CommentLine,
  doc: Pick<TextDocumentLike, 'positionAt'>,
  buckets: DecorationBuckets,
  editableLines: readonly EditableLineRange[],
  options: ScanOptions
): boolean {
  if (!HORIZONTAL_RULE_RE.test(line.text)) return false;

  const lineEnd = line.start + line.text.length;
  if (!options.hideMarkers || touchesEditableLine(doc, line.start, lineEnd, editableLines)) {
    buckets.horizontalRuleOptions.push({
      range: span(line.start, lineEnd),
      renderOptions: { after: { contentText: '  ────────────────────────' } },
    });
    return true;
  }

  buckets.hiddenRanges.push(span(line.start, lineEnd));
  buckets.horizontalRuleOptions.push({
    range: span(line.start, line.start),
    renderOptions: { before: { contentText: '──────────────────────────' } },
  });
  return true;
}

function scanLineMarkdown(
  line: CommentLine,
  doc: Pick<TextDocumentLike, 'positionAt'>,
  buckets: DecorationBuckets,
  editableLines: readonly EditableLineRange[],
  options: ScanOptions
): void {
  const { start, text } = line;

  if (scanHorizontalRule(line, doc, buckets, editableLines, options)) {
    return;
  }

  scanBlockquote(line, doc, buckets, editableLines, options);
  scanListMarker(line, doc, buckets, editableLines, options);

  // Scan for backslash escapes to hide the backslash character.
  const escapeRegex = new RegExp(ESCAPE_RE);
  let esm: RegExpExecArray | null;
  while ((esm = escapeRegex.exec(text)) !== null) {
    const backslashAbs = start + esm.index;
    if (!touchesEditableLine(doc, backslashAbs, backslashAbs + 2, editableLines)) {
      buckets.hiddenRanges.push(span(backslashAbs, backslashAbs + 1));
    }
  }

  const { codeSpans, links, emphasis } = parseInlineSpans(text);

  // ── Code spans ─────────────────────────────────────────────────────────────
  for (const cs of codeSpans) {
    const outerStart = start + cs.outerStart;
    const outerEnd = start + cs.outerEnd;
    const contentStart = outerStart + cs.tickLen;
    const contentEnd = outerEnd - cs.tickLen;
    const isEditable = touchesEditableLine(doc, outerStart, outerEnd, editableLines);

    if (options.hideMarkers && !isEditable) {
      buckets.hiddenRanges.push(span(outerStart, outerEnd));
      buckets.codeRanges.push({
        range: span(outerStart, outerStart),
        renderOptions: {
          before: {
            contentText: cs.content,
            backgroundColor: themeColor('markdownInplace.codeSpanBackground'),
            textDecoration: 'none; border-radius: 3px;',
            border: '1px solid',
            borderColor: themeColor('markdownInplace.codeSpanBackground'),
            borderRadius: '3px',
          },
        },
      });
    } else {
      buckets.codeRanges.push({ range: span(contentStart, contentEnd) });
    }
  }

  // ── Links ──────────────────────────────────────────────────────────────────
  for (const lk of links) {
    const outerStart = start + lk.outerStart;
    const outerEnd = start + lk.outerEnd;
    const textStart = start + lk.textStart;
    const textEnd = start + lk.textEnd;
    const isEditable = touchesEditableLine(doc, outerStart, outerEnd, editableLines);

    if (lk.image && options.hideMarkers && !isEditable) {
      // Image entry ![alt](src). The alt text stays visible (for hover/readability)
      // and, when enabled, the inline image is shown before it. When nested in a
      // link, the surrounding link entry supplies the clickable navigation.
      const altStart = start + lk.image.altStart;
      const altEnd = start + lk.image.altEnd;
      buckets.hiddenRanges.push(span(outerStart, altStart));
      buckets.hiddenRanges.push(span(altEnd, outerEnd));
      if (altStart < altEnd) {
        buckets.linkRanges.push(span(altStart, altEnd));
      }
      if (options.renderInlineImages) {
        buckets.imageRanges.push({ range: span(outerStart, outerStart), src: lk.image.src });
      }
    } else {
      if (!isEditable) {
        buckets.hiddenRanges.push(span(outerStart, textStart));
        buckets.hiddenRanges.push(span(textEnd, outerEnd));
      }
      const contentRange = span(textStart, textEnd);
      buckets.linkRanges.push(contentRange);
      if (lk.dest !== undefined) {
        buckets.links.push({ range: contentRange, url: lk.dest });
      }
    }
  }

  // ── Emphasis ───────────────────────────────────────────────────────────────
  for (const r of emphasis.boldItalic) {
    buckets.boldItalicRanges.push(span(start + r.start, start + r.end));
  }
  for (const r of emphasis.bold) {
    buckets.boldRanges.push(span(start + r.start, start + r.end));
  }
  for (const r of emphasis.italic) {
    buckets.italicRanges.push(span(start + r.start, start + r.end));
  }
  for (const r of emphasis.strike) {
    buckets.strikeRanges.push(span(start + r.start, start + r.end));
  }
  for (const mk of emphasis.markers) {
    const a = start + mk.start;
    const b = start + mk.end;
    if (options.hideMarkers && !touchesEditableLine(doc, a, b, editableLines)) {
      buckets.hiddenRanges.push(span(a, b));
    }
  }

  // ── Headings ───────────────────────────────────────────────────────────────
  const headingRegex = /^([ \t]*)(#{1,6})([ \t]+)(.+)$/;
  const hm = headingRegex.exec(text);
  if (hm) {
    const level = hm[2].length;
    const hashStart = start + hm[1].length;
    const hashEnd = hashStart + hm[2].length + hm[3].length;
    const contentEnd = start + hm[0].length;
    if (!touchesEditableLine(doc, hashStart, contentEnd, editableLines)) {
      buckets.hiddenRanges.push(span(hashStart, hashEnd));
    }
    buckets.headingRangesByLevel[level - 1].push(span(hashEnd, contentEnd));
  }
}
