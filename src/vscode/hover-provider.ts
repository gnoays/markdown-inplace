import * as vscode from 'vscode';
import { resolveLinkTarget, readDocumentText } from './link-targets';
import { Settings } from './settings';
import { log } from '../extension';
import { extractCommentLinesFromDocument, getCommentSyntax, parseInlineSpans, TextDocumentLike } from '../core';

const MAX_SECTION_LINES = 30;
const HEADING_RE = /^(#{1,6})\s/;

function makeDocumentLike(text: string): TextDocumentLike {
  const rawLines = text.split(/\r?\n/);
  const offsets: number[] = [];
  let off = 0;
  for (const l of rawLines) {
    offsets.push(off);
    off += l.length + 1;
  }
  return {
    lineAt: (line: number) => ({ text: rawLines[line] ?? '' }),
    offsetAt: (pos) => (offsets[pos.line] ?? 0) + pos.character,
    positionAt: (offset) => {
      let lo = 0, hi = rawLines.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= offset) lo = mid; else hi = mid - 1;
      }
      return { line: lo, character: offset - offsets[lo] };
    },
  };
}

function languageIdFromUri(uri: vscode.Uri): string {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (open) return open.languageId;
  const ext = uri.path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact',
    js: 'javascript', jsx: 'javascriptreact',
    mjs: 'javascript', cjs: 'javascript',
    py: 'python', rb: 'ruby', go: 'go',
    rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
    cs: 'csharp', php: 'php', swift: 'swift',
    kt: 'kotlin', sh: 'shellscript',
  };
  return map[ext] ?? ext;
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+\-.!|]/g, '\\$&');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractSectionMarkdown(fileText: string, headingLine: number, languageId: string): string | undefined {
  const rawLines = fileText.split(/\r?\n/);

  if (languageId === 'markdown') {
    const hm = HEADING_RE.exec(rawLines[headingLine] ?? '');
    const level = hm ? hm[1].length : 0;
    const result: string[] = [];
    for (let i = headingLine; i < rawLines.length && result.length < MAX_SECTION_LINES; i++) {
      const m = HEADING_RE.exec(rawLines[i]);
      if (i > headingLine && m && (level === 0 || m[1].length <= level)) break;
      result.push(rawLines[i]);
    }
    if (result.length === MAX_SECTION_LINES && headingLine + MAX_SECTION_LINES < rawLines.length) {
      result.push('...');
    }
    return result.join('\n') || undefined;
  }

  const syntax = getCommentSyntax(languageId);
  if (!syntax) return undefined;

  const docLike = makeDocumentLike(fileText);
  const commentLines = extractCommentLinesFromDocument(docLike, syntax, headingLine, rawLines.length - 1);
  if (commentLines.length === 0) return undefined;

  const hm = HEADING_RE.exec(commentLines[0].text);
  const level = hm ? hm[1].length : 0;

  const result: string[] = [];
  for (const cl of commentLines) {
    if (result.length >= MAX_SECTION_LINES) break;
    const m = HEADING_RE.exec(cl.text);
    if (result.length > 0 && m && level > 0 && m[1].length <= level) break;
    result.push(cl.text);
  }
  if (result.length === MAX_SECTION_LINES && commentLines.length > MAX_SECTION_LINES) {
    result.push('...');
  }
  return result.join('\n') || undefined;
}

export function registerLinkHoverProvider(context: vscode.ExtensionContext, settings: Settings) {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: '*' }, {
      async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        if (!settings.renderLinkHover) return undefined;

        const lineText = document.lineAt(position.line).text;
        // Reuse the same scanner that drives decorations/clicks so the hover
        // resolves the identical link (correct bracket nesting, outer dest).
        const { links } = parseInlineSpans(lineText);
        for (const link of links) {
          if (link.image || !link.dest) continue;
          if (position.character < link.outerStart || position.character > link.outerEnd) continue;

          const hoveredImage = links.some((entry) => entry.image &&
            link.textStart <= entry.outerStart && entry.outerEnd <= link.textEnd &&
            position.character >= entry.outerStart && position.character <= entry.outerEnd);
          if (hoveredImage) continue;
          const resolved = await resolveLinkTarget(document, link.dest, { allowedSchemes: [] });
          if (!resolved) continue;

          if (!resolved.fragment.match(/^L\d+$/)) continue;

          const headingLine = parseInt(resolved.fragment.slice(1)) - 1;
          const fileUri = resolved.with({ fragment: '' });
          const fileText = await readDocumentText(fileUri);
          if (!fileText) continue;

          const langId = languageIdFromUri(fileUri);
          const sectionMd = extractSectionMarkdown(fileText, headingLine, langId);
          if (!sectionMd) continue;

          log(`Link hover: ${fileUri.fsPath}#L${headingLine + 1} lang=${langId}`);
          const range = new vscode.Range(position.line, link.outerStart, position.line, link.outerEnd);
          const md = new vscode.MarkdownString(sectionMd);
          md.isTrusted = false;
          return new vscode.Hover(md, range);
        }
        return undefined;
      }
    })
  );
}

export function registerImageHoverProvider(context: vscode.ExtensionContext, settings: Settings) {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: '*' }, {
      async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        if (!settings.renderImageHover) return undefined;

        const lineText = document.lineAt(position.line).text;
        const { links } = parseInlineSpans(lineText);

        for (const entry of links) {
          if (!entry.image) continue;

          // An image is "in a link" when a real link's text fully encloses it,
          // i.e. [![alt](img)](url). Such a hover renders a clickable image.
          const wrapping = links.find((l) => !l.image && l.dest &&
            l.textStart <= entry.outerStart && entry.outerEnd <= l.textEnd);
          const rangeStart = entry.outerStart;
          const rangeEnd = entry.outerEnd;
          if (position.character < rangeStart || position.character > rangeEnd) continue;

          const img = entry.image;
          const resolved = await resolveLinkTarget(document, img.src, { allowedSchemes: ['file', 'http', 'https'] });
          if (!resolved) continue;

          const width = settings.hoverImageMaxWidth;
          const src = escapeHtmlAttribute(resolved.toString());
          const alt = escapeMarkdownText(lineText.slice(img.altStart, img.altEnd));
          const range = new vscode.Range(position.line, rangeStart, position.line, rangeEnd);

          let md: vscode.MarkdownString;
          if (wrapping?.dest) {
            const href = escapeHtmlAttribute(wrapping.dest.trim());
            md = new vscode.MarkdownString(`<a href="${href}"><img src="${src}" alt="${alt}" width="${width}" /></a>`);
            log(`Image-in-link hover: img=${resolved} link=${href}`);
          } else {
            const titleHeader = img.srcTitle ? `**${escapeMarkdownText(img.srcTitle)}**\n\n` : '';
            md = new vscode.MarkdownString(`${titleHeader}<img src="${src}" width="${width}" />`);
            log(`Image hover: img=${resolved}`);
          }
          md.supportHtml = true;
          md.isTrusted = false;
          return new vscode.Hover(md, range);
        }

        return undefined;
      }
    })
  );
}
