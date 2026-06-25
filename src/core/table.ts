import { CommentLine, TextDocumentLike } from './types';
import { isEscapedAt } from './markdown';

export interface TableCell {
  contentStart: number;
  contentEnd: number;
  rawEnd: number;
  text: string;
}

export interface TableRow {
  line: CommentLine;
  cells: TableCell[];
  pipeOffsets: number[];
  isSeparator: boolean;
}

export function collectTableRows(
  lines: CommentLine[],
  startIndex: number,
  doc: Pick<TextDocumentLike, 'positionAt'>
): TableRow[] | undefined {
  const header = parseTableRow(lines[startIndex]);
  const separatorLine = lines[startIndex + 1];
  if (!header || !separatorLine) return undefined;

  const separator = parseTableRow(separatorLine);
  if (!separator?.isSeparator) return undefined;
  if (header.cells.length < 2 || separator.cells.length < 2) return undefined;

  const headerDocLine = doc.positionAt(header.line.start).line;
  const separatorDocLine = doc.positionAt(separator.line.start).line;
  if (separatorDocLine !== headerDocLine + 1) return undefined;

  const rows = [header, separator];
  let lastDocLine = separatorDocLine;

  for (let i = startIndex + 2; i < lines.length; i++) {
    const nextDocLine = doc.positionAt(lines[i].start).line;
    if (nextDocLine !== lastDocLine + 1) break;

    const row = parseTableRow(lines[i]);
    if (!row || row.isSeparator) break;

    rows.push(row);
    lastDocLine = nextDocLine;
  }

  return rows;
}

export function parseTableRow(line: CommentLine): TableRow | undefined {
  const pipeOffsets: number[] = [];
  for (let i = 0; i < line.text.length; i++) {
    if (line.text[i] === '|' && !isEscapedAt(line.text, i)) {
      pipeOffsets.push(i);
    }
  }
  if (pipeOffsets.length === 0) return undefined;

  const boundaries = [-1, ...pipeOffsets, line.text.length];
  const cells: TableCell[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const rawStart = boundaries[i] + 1;
    const rawEnd = boundaries[i + 1];
    const raw = line.text.slice(rawStart, rawEnd);

    if ((i === 0 || i === boundaries.length - 2) && raw.trim() === '') {
      continue;
    }

    const leading = raw.match(/^[ \t]*/)?.[0].length ?? 0;
    const trailing = raw.match(/[ \t]*$/)?.[0].length ?? 0;
    const contentStart = rawStart + leading;
    const contentEnd = Math.max(contentStart, rawEnd - trailing);

    cells.push({
      contentStart,
      contentEnd,
      rawEnd,
      text: line.text.slice(contentStart, contentEnd),
    });
  }

  if (cells.length < 2) return undefined;

  return {
    line,
    cells,
    pipeOffsets,
    isSeparator: cells.every((cell) => /^:?-{3,}:?$/.test(cell.text.trim())),
  };
}
