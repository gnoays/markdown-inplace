import * as vscode from 'vscode';
import { resolveLinkTarget, readDocumentText } from './link-targets';
import { Settings } from './settings';
import { log } from '../extension';
import { extractCommentLinesFromDocument, extractLinkDestination, getCommentSyntax, TextDocumentLike } from '../core';

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
        const linkRegex = /(?<![!\\])\[((?:[^\]\n\\]|\\.)+?)\]\(((?:[^)\n\\]|\\.)+?)\)/g;
        let m: RegExpExecArray | null;
        while ((m = linkRegex.exec(lineText)) !== null) {
          const matchStart = m.index;
          const matchEnd = matchStart + m[0].length;
          if (position.character < matchStart || position.character > matchEnd) continue;

          const dest = extractLinkDestination(m[2]);
          if (!dest) continue;

          const resolved = await resolveLinkTarget(document, dest.url, { allowedSchemes: [] });
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
          const range = new vscode.Range(position.line, matchStart, position.line, matchEnd);
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

        // [![alt](img_url)](link_url) — image-in-link: show clickable image in hover
        const imgInLinkRegex = /\[!\[([^\]]*)\]\(([^)]*)\)\]\(([^)]+)\)/g;
        let m: RegExpExecArray | null;
        while ((m = imgInLinkRegex.exec(lineText)) !== null) {
          const startChar = m.index;
          const endChar = startChar + m[0].length;
          if (position.character < startChar || position.character > endChar) continue;

          const imgDest = extractLinkDestination(m[2]);
          if (!imgDest) continue;
          const resolved = await resolveLinkTarget(document, imgDest.url, { allowedSchemes: ['file', 'http', 'https'] });
          if (!resolved) continue;

          const width = settings.hoverImageMaxWidth;
          const src = escapeHtmlAttribute(resolved.toString());
          const link = escapeHtmlAttribute(m[3].trim());
          const alt = escapeMarkdownText(m[1]);
          const range = new vscode.Range(position.line, startChar, position.line, endChar);
          const md = new vscode.MarkdownString(`<a href="${link}"><img src="${src}" alt="${alt}" width="${width}" /></a>`);
          md.supportHtml = true;
          md.isTrusted = false;
          log(`Image-in-link hover: img=${resolved} link=${link}`);
          return new vscode.Hover(md, range);
        }

        // Markdown image syntax: ![caption](url) or ![caption](url "title")
        const imgRegex = /(!\[.*?\])\(\s*([^\s\)]+)(?:\s+["'(](.*?)["')])?\s*\)/g;
        while ((m = imgRegex.exec(lineText)) !== null) {
          const startChar = m.index;
          const endChar = startChar + m[0].length;
          if (position.character >= startChar && position.character <= endChar) {
            const range = new vscode.Range(position.line, startChar, position.line, endChar);
            const resolved = await resolveLinkTarget(document, m[2], { allowedSchemes: ['file', 'http', 'https'] });
            log(`Link: ${resolved}`);
            if (resolved) {
              const width = settings.hoverImageMaxWidth;
              const titleHeader = m[3] ? `**${escapeMarkdownText(m[3])}**\n\n` : '';
              const src = escapeHtmlAttribute(resolved.toString());
              const md = new vscode.MarkdownString(`${titleHeader}<img src="${src}" width="${width}" />`);
              md.supportHtml = true;
              md.isTrusted = false;
              return new vscode.Hover(md, range);
            }
          }
        }

        return undefined;
      }
    })
  );
}
