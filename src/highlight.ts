// Tokenize code inside fenced code blocks using Prism.js, and
// return which absolute offset ranges to paint in which category colors.
// Since VS Code's decoration API cannot read theme token colors, we group
// Prism's detailed token types into a few categories, and map them to
// theme-independent ThemeColors (such as terminal.ansi*) on the caller side.

import * as Prism from 'prismjs';
// The Prism core (~37ms) is loaded at startup, but evaluation of grammars for all 297 languages (~1.4s) is
// heavy, so we don't do it at startup. It is delayed until the moment we first highlight a fenced code block.
// The synchronous require inside the function is bundled into a single file by esbuild, and is only evaluated
// on the first call (all languages are registered to Prism.languages via side-effect imports).
let languagesLoaded = false;
function ensureLanguagesLoaded(): void {
  if (languagesLoaded) return;
  require('./prism-languages.generated');
  languagesLoaded = true;
}

export type SyntaxCategory = 'keyword' | 'function' | 'string' | 'number' | 'comment';

export interface HighlightSpan {
  start: number; // Absolute offset in the document
  end: number;
  category: SyntaxCategory;
}

// Fence info string / VS Code languageId -> Prism language ID
const LANG_ALIAS: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  ps: 'powershell',
  ps1: 'powershell',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  golang: 'go',
  kt: 'kotlin',
  kts: 'kotlin',
  dockerfile: 'docker',
  htm: 'markup',
  html: 'markup',
  xml: 'markup',
  vue: 'markup',
  text: 'none',
  plaintext: 'none',
};

// Prism token type -> Category. Unlisted types (operator, punctuation, variable, etc.) are
// kept as their default colors and not painted.
const TYPE_TO_CATEGORY: Record<string, SyntaxCategory> = {
  comment: 'comment',
  prolog: 'comment',
  cdata: 'comment',
  doctype: 'keyword',
  keyword: 'keyword',
  atrule: 'keyword',
  important: 'keyword',
  tag: 'keyword',
  selector: 'keyword',
  entity: 'keyword',
  rule: 'keyword',
  'attr-name': 'function',
  function: 'function',
  'function-variable': 'function',
  'class-name': 'function',
  'maybe-class-name': 'function',
  builtin: 'function',
  namespace: 'function',
  decorator: 'function',
  annotation: 'function',
  string: 'string',
  char: 'string',
  'attr-value': 'string',
  regex: 'string',
  url: 'string',
  'template-string': 'string',
  number: 'number',
  boolean: 'number',
  constant: 'number',
  symbol: 'number',
  unit: 'number',
};

// Resolve the Prism language ID from the fence info string (e.g., "python", "ts {.line-numbers}").
// Since all languages are statically imported at startup, just check if it is registered.
function resolveLanguage(info: string): string | undefined {
  const first = (info || '').trim().split(/\s+/)[0]?.toLowerCase();
  if (!first || first === 'none') return undefined;

  const id = LANG_ALIAS[first] ?? first;
  if (id === 'none') return undefined;

  return (Prism.languages as Record<string, unknown>)[id] ? id : undefined;
}

type Stream = Array<string | Prism.Token>;

// lines are the target code lines to scan (excluding the fence ``` lines). Each line's start is
// the absolute offset in the document where the body of that line starts. Tokenize lines
// as a single string concatenated with newlines, and map tokens back to lines/columns to get absolute ranges.
export function highlightFenceLines(
  info: string,
  lines: Array<{ start: number; text: string }>
): HighlightSpan[] {
  ensureLanguagesLoaded();
  const langId = resolveLanguage(info);
  if (!langId) return [];

  const grammar = (Prism.languages as Record<string, Prism.Grammar>)[langId];
  if (!grammar) return [];

  const code = lines.map((l) => l.text).join('\n');
  let tokens: Stream;
  try {
    tokens = Prism.tokenize(code, grammar) as Stream;
  } catch {
    return [];
  }

  const spans: HighlightSpan[] = [];
  let li = 0; // Current line index (within lines)
  let col = 0; // Offset within the text of the current line

  // Emit token string. If it spans multiple lines due to internal newlines, split it by line and range each part.
  const emit = (segment: string, category: SyntaxCategory | undefined) => {
    const parts = segment.split('\n');
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) {
        li++;
        col = 0;
      }
      const part = parts[p];
      const lineInfo = lines[li];
      if (part.length > 0 && category && lineInfo) {
        const absStart = lineInfo.start + col;
        spans.push({ start: absStart, end: absStart + part.length, category });
      }
      col += part.length;
    }
  };

  const walk = (stream: Stream, inheritedType?: string) => {
    for (const token of stream) {
      if (typeof token === 'string') {
        emit(token, inheritedType ? TYPE_TO_CATEGORY[inheritedType] : undefined);
        continue;
      }
      const type = token.type || inheritedType;
      const content = token.content;
      if (typeof content === 'string') {
        emit(content, type ? TYPE_TO_CATEGORY[type] : undefined);
      } else if (Array.isArray(content)) {
        walk(content as Stream, type);
      } else {
        // Single nested token
        walk([content] as Stream, type);
      }
    }
  };

  walk(tokens);
  return spans;
}
