import { CommentSyntax } from './types';

export const COMMENT_SYNTAX: Record<string, CommentSyntax> = {
  // Example:
  // javascript: { line: ['//'], block: [['/*', '*/']] },
  // python: { line: ['#'] },
  // html: { block: [['<!--', '-->']] },
};

let dynamicSyntax = new Map<string, CommentSyntax>();

export function setDynamicCommentSyntax(map: Map<string, CommentSyntax>): void {
  dynamicSyntax = map;
}

export function getCommentSyntax(languageId: string): CommentSyntax | undefined {
  return dynamicSyntax.get(languageId) ?? COMMENT_SYNTAX[languageId];
}

export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

export function syntaxFromComments(comments: unknown): CommentSyntax | undefined {
  if (!comments || typeof comments !== 'object') return undefined;

  const source = comments as { lineComment?: unknown; blockComment?: unknown };
  const syntax: CommentSyntax = {};
  if (typeof source.lineComment === 'string' && source.lineComment.length > 0) {
    syntax.line = [source.lineComment];
  }
  if (
    Array.isArray(source.blockComment) &&
    source.blockComment.length === 2 &&
    typeof source.blockComment[0] === 'string' &&
    typeof source.blockComment[1] === 'string'
  ) {
    syntax.block = [[source.blockComment[0], source.blockComment[1]]];
  }
  return syntax.line || syntax.block ? syntax : undefined;
}
