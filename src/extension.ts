import * as vscode from 'vscode';
import {
  COMMENT_SYNTAX,
  CommentSyntax,
  CommentBlockState,
  DecorationBuckets,
  DecorationRenderSpec,
  DecorationSpec,
  EditableLineRange,
  ScanOptions,
  TextSpan,
  TextDocumentLike,
  collectTableRows,
  createDecorationBuckets,
  extractAllLines,
  extractCommentLinesFromDocument,
  getCommentBlockStates,
  getCommentSyntax,
  markdownDisplayWidth,
  scanComments as scanCommentDecorations,
} from './core';
import { highlightFenceLines, SyntaxCategory } from './highlight';
import { loadLanguageConfigurations } from './vscode/language-config';
import { resolveLinkTarget } from './vscode/link-targets';
import { readSettings, registerToggleCommands, applyConfigChange, Settings, Recreate } from './vscode/settings';
import { Decorations } from './vscode/decorations-registry';
import { registerImageHoverProvider, registerLinkHoverProvider } from './vscode/hover-provider';

export {
  COMMENT_SYNTAX,
  collectTableRows,
  extractAllLines,
  extractCommentLinesFromDocument,
  getCommentBlockStates,
  getCommentSyntax,
  markdownDisplayWidth,
  parseTableRow,
} from './core';

// Body of a physical line in a comment (excluding markers).
// Block comments are also split into lines internally, so subsequent processes always handle a single line.
interface LinkInfo {
  range: TextSpan;
  url: string;
}

function toVscodeRange(doc: vscode.TextDocument, textSpan: TextSpan): vscode.Range {
  return new vscode.Range(doc.positionAt(textSpan.start), doc.positionAt(textSpan.end));
}

function toVscodeRenderOptions(renderOptions: DecorationRenderSpec | undefined): vscode.DecorationInstanceRenderOptions | undefined {
  if (!renderOptions) return undefined;
  const convertAttachment = (attachment: NonNullable<DecorationRenderSpec['before']>) => ({
    ...attachment,
    color: typeof attachment.color === 'object' ? new vscode.ThemeColor(attachment.color.themeColor) : attachment.color,
    backgroundColor: typeof attachment.backgroundColor === 'object'
      ? new vscode.ThemeColor(attachment.backgroundColor.themeColor)
      : attachment.backgroundColor,
    borderColor: typeof attachment.borderColor === 'object'
      ? new vscode.ThemeColor(attachment.borderColor.themeColor)
      : attachment.borderColor
  });

  return {
    before: renderOptions.before ? convertAttachment(renderOptions.before) : undefined,
    after: renderOptions.after ? convertAttachment(renderOptions.after) : undefined,
  };
}

function toDecorationOptions(doc: vscode.TextDocument, specs: readonly DecorationSpec[]): vscode.DecorationOptions[] {
  return specs.map((spec) => ({
    range: toVscodeRange(doc, spec.range),
    renderOptions: toVscodeRenderOptions(spec.renderOptions),
  }));
}

function toRanges(doc: vscode.TextDocument, ranges: readonly TextSpan[]): vscode.Range[] {
  return ranges.map((range) => toVscodeRange(doc, range));
}

// --- Decoration Types ---
let decos: Decorations;

let settings: Settings;
let timeout: NodeJS.Timeout | undefined;
let currentLinks: LinkInfo[] = [];
let lastCursorLine: number | undefined;
let lastSelectionsKey = '';
let lastVisibleRangesKey = '';
let lastRenderKey = '';

interface CommentStateCache {
  uri: string;
  version: number;
  languageId: string;
  syntaxKey: string;
  states: CommentBlockState[];
}

let commentStateCache: CommentStateCache | undefined;

let outputChannel: vscode.OutputChannel;

const FULL_UPDATE_DELAY_MS = 150;
const SELECTION_UPDATE_DELAY_MS = 50;
const VISIBLE_CONTEXT_LINES = 200;

export function log(message: string) {
  const ts = new Date().toISOString();
  outputChannel?.appendLine(`[${ts}] ${message}`);
}





export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Markdown InPlace');
  context.subscriptions.push(outputChannel);
  log('Extension activated');

  settings = readSettings();
  decos = new Decorations(settings);
  context.subscriptions.push(decos);

  log(
    `Settings loaded: enabled=${settings.enabled}, hideMarkers=${settings.hideMarkers}, headingUppercase=${settings.headingUppercase}, ` +
    `renderFencedCode=${settings.renderFencedCode}, renderFencedCodeBackground=${settings.renderFencedCodeBackground}, fencedCodeFullWidth=${settings.fencedCodeFullWidth}, renderLists=${settings.renderLists}, renderTables=${settings.renderTables}, ` +
    `renderBlockquotes=${settings.renderBlockquotes}, renderMarkdownFile=${settings.renderMarkdownFile}, ` +
    `languages=${JSON.stringify(settings.languages)}`
  );

  const onChange = (r?: Recreate) => {
    if (r) {
      decos.recreate(r);
    }
    triggerUpdate();
  };

  registerToggleCommands(context, settings, onChange, log);

  // Reflect changes on the settings screen immediately
  vscode.workspace.onDidChangeConfiguration(
    (e) => {
      if (e.affectsConfiguration('markdownInplace')) {
        const onChangeConfig = (r?: Recreate) => {
          if (r) {
            decos.recreate(r);
          }
        };
        if (applyConfigChange(settings, onChangeConfig, log)) {
          triggerUpdate(FULL_UPDATE_DELAY_MS);
        }
      }
    },
    null,
    context.subscriptions
  );

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    lastCursorLine = editor?.selection.active.line;
    lastSelectionsKey = editor ? selectionsKey(editor.selections) : '';
    lastVisibleRangesKey = '';
    lastRenderKey = '';
    triggerUpdate(FULL_UPDATE_DELAY_MS);
  }, null, context.subscriptions);
  vscode.workspace.onDidChangeTextDocument(
    (e) => {
      if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
        triggerUpdate(FULL_UPDATE_DELAY_MS);
      }
    },
    null,
    context.subscriptions
  );
  // Display markers without hiding them when the cursor is near them (to make editing easier)
  vscode.window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor !== vscode.window.activeTextEditor) return;
    const nextCursorLine = e.selections[0]?.active.line;
    const nextSelectionsKey = selectionsKey(e.selections);
    if (nextCursorLine === lastCursorLine && nextSelectionsKey === lastSelectionsKey) return;
    lastCursorLine = nextCursorLine;
    lastSelectionsKey = nextSelectionsKey;
    triggerUpdate(SELECTION_UPDATE_DELAY_MS);
  }, null, context.subscriptions);
  vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
    if (e.textEditor !== vscode.window.activeTextEditor) return;

    const nextKey = visibleRangesKey(e.textEditor);
    if (nextKey === lastVisibleRangesKey) return;
    lastVisibleRangesKey = nextKey;
    triggerUpdate(FULL_UPDATE_DELAY_MS);
  }, null, context.subscriptions);

  // Allow opening links with Ctrl+Click
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider({ scheme: '*' }, {
      async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
        if (document !== vscode.window.activeTextEditor?.document) {
          return [];
        }
        const resolved = await Promise.all(
          currentLinks.map(async (l) => {
            const target = await resolveLinkTarget(document, l.url);
            if (!target) {
              log(`Skipped resolving link target: ${l.url}`);
            }
            return target ? new vscode.DocumentLink(toVscodeRange(document, l.range), target) : undefined;
          })
        );
        return resolved.filter((x): x is vscode.DocumentLink => x !== undefined);
      },
    })
  );

  if (vscode.window.activeTextEditor) {
    lastCursorLine = vscode.window.activeTextEditor.selection.active.line;
    lastSelectionsKey = selectionsKey(vscode.window.activeTextEditor.selections);
    triggerUpdate(FULL_UPDATE_DELAY_MS);
  }

  registerImageHoverProvider(context, settings);
  registerLinkHoverProvider(context, settings);

  // Loading language-configuration.json is asynchronous. Until it completes, it runs with static
  // COMMENT_SYNTAX, and redrafts to switch to dynamic definitions after loading.
  loadLanguageConfigurations(log)
    .then(() => triggerUpdate(FULL_UPDATE_DELAY_MS))
    .catch((err) => log(`Dynamic load failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`));
}

function triggerUpdate(delayMs = FULL_UPDATE_DELAY_MS) {
  if (timeout) {
    clearTimeout(timeout);
  }
  timeout = setTimeout(updateDecorations, delayMs);
}

function visibleRangesKey(editor: vscode.TextEditor): string {
  return editor.visibleRanges.map((range) => `${range.start.line}`).join('|');
}

function selectionsKey(selections: readonly vscode.Selection[]): string {
  return selections
    .map((selection) => `${selection.start.line}:${selection.start.character}-${selection.end.line}:${selection.end.character}`)
    .join(',');
}

function clearAllDecorations(editor: vscode.TextEditor) {
  for (const deco of decos.getAllTypes()) {
    editor.setDecorations(deco, []);
  }
  currentLinks = [];
  lastRenderKey = '';
}

function commentSyntaxKey(syntax: CommentSyntax | undefined): string {
  if (!syntax) return '';
  return JSON.stringify({ line: syntax.line ?? [], block: syntax.block ?? [] });
}

function getCachedCommentBlockState(
  doc: vscode.TextDocument,
  syntax: CommentSyntax,
  syntaxKey: string,
  line: number
): CommentBlockState {
  const uri = doc.uri.toString();
  if (
    !commentStateCache ||
    commentStateCache.uri !== uri ||
    commentStateCache.version !== doc.version ||
    commentStateCache.languageId !== doc.languageId ||
    commentStateCache.syntaxKey !== syntaxKey
  ) {
    commentStateCache = {
      uri,
      version: doc.version,
      languageId: doc.languageId,
      syntaxKey,
      states: getCommentBlockStates(wrapDocument(doc), syntax, doc.lineCount),
    };
  }

  return commentStateCache.states[line] ?? { inBlock: false, activeBlockClose: '' };
}

function updateDecorations() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  if (!settings.enabled) {
    clearAllDecorations(editor);
    return;
  }

  const doc = editor.document;

  // Markdown files do not perform comment extraction; the entire line is directly targeted for decoration.
  // Independently of the languages filter, it is turned ON/OFF only by renderMarkdownFile.
  const isMarkdownFile = settings.renderMarkdownFile && doc.languageId === 'markdown';
  let syntax: CommentSyntax | undefined;

  if (!isMarkdownFile) {
    if (settings.languages.length > 0 && !settings.languages.includes(doc.languageId)) {
      clearAllDecorations(editor);
      return;
    }

    syntax = getCommentSyntax(doc.languageId);
    if (!syntax) {
      // If the language is not supported, comment syntax is unknown, so do nothing to avoid false detection
      clearAllDecorations(editor);
      return;
    }
  }

  try {
    const buckets = createDecorationBuckets();

    // Do not hide markers on lines within the selection (because it's hard to handle if symbols or selection positions are invisible during editing)
    const cursorLine = editor.selection.active.line;
    const editableLines: EditableLineRange[] = editor.selections.map((selection) => ({
      startLine: Math.min(selection.start.line, selection.end.line),
      endLine: Math.max(selection.start.line, selection.end.line),
    }));
    const scanOptions: ScanOptions = {
      hideMarkers: settings.hideMarkers,
      renderFencedCode: settings.renderFencedCode,
      renderFencedCodeBackground: settings.renderFencedCodeBackground,
      highlightFencedCode: settings.highlightFencedCode,
      renderLists: settings.renderLists,
      renderTables: settings.renderTables,
      renderBlockquotes: settings.renderBlockquotes,
    };
    const currentSelectionsKey = selectionsKey(editor.selections);
    const targetRange = getScanLineRange(editor);
    const syntaxKey = isMarkdownFile ? '' : commentSyntaxKey(syntax);
    const renderKey = [
      doc.uri.toString(),
      doc.version,
      targetRange.startLine,
      targetRange.endLine,
      cursorLine,
      currentSelectionsKey,
      settings.enabled,
      settings.hideMarkers,
      settings.headingUppercase,
      settings.renderFencedCode,
      settings.renderFencedCodeBackground,
      settings.highlightFencedCode,
      settings.renderLists,
      settings.renderTables,
      settings.renderBlockquotes,
      isMarkdownFile,
      syntaxKey,
      settings.languages.join(','),
    ].join('|');

    if (renderKey === lastRenderKey) {
      return;
    }

    const docLike = wrapDocument(doc);
    const commentLines = isMarkdownFile
      ? extractAllLines(docLike, targetRange.startLine, targetRange.endLine)
      : extractCommentLinesFromDocument(
        docLike,
        syntax!,
        targetRange.startLine,
        targetRange.endLine,
        getCachedCommentBlockState(doc, syntax!, syntaxKey, targetRange.startLine)
      );

    scanCommentDecorations(commentLines, doc, buckets, editableLines, scanOptions);

    const simpleSpecs: [Parameters<typeof decos.get>[0], readonly TextSpan[]][] = [
      ['bold', buckets.boldRanges],
      ['italic', buckets.italicRanges],
      ['boldItalic', buckets.boldItalicRanges],
      ['strike', buckets.strikeRanges],
      ['link', buckets.linkRanges],
      ['tablePipe', buckets.tablePipeRanges],
      ['tableSeparator', buckets.tableSeparatorRanges],
      ['tableHeader', buckets.tableHeaderRanges],
      ['tableTrailingWhitespace', buckets.tableTrailingWhitespaceRanges],
    ];
    for (const [name, spans] of simpleSpecs) {
      editor.setDecorations(decos.get(name), toRanges(doc, spans));
    }

    const optionSpecs: [Parameters<typeof decos.get>[0], readonly DecorationSpec[]][] = [
      ['code', buckets.codeRanges],
      ['listGlyph', buckets.listGlyphOptions],
      ['horizontalRule', buckets.horizontalRuleOptions],
      ['blockquote', buckets.blockquoteOptions],
      ['tablePadding', buckets.tablePaddingOptions],
    ];
    for (const [name, specs] of optionSpecs) {
      editor.setDecorations(decos.get(name), toDecorationOptions(doc, specs));
    }

    editor.setDecorations(decos.get('hidden'), settings.hideMarkers ? toRanges(doc, buckets.hiddenRanges) : []);
    editor.setDecorations(decos.fence, toDecorationOptions(doc, buckets.fenceCodeRanges));

    for (const category of Object.keys(decos.syntax) as SyntaxCategory[]) {
      editor.setDecorations(decos.syntax[category], toRanges(doc, buckets.syntaxRanges[category]));
    }

    decos.headings.forEach((d, i) => editor.setDecorations(d, toRanges(doc, buckets.headingRangesByLevel[i])));

    currentLinks = buckets.links;
    lastRenderKey = renderKey;

    log(
      `Update completed: lang=${doc.languageId} scan=${targetRange.startLine}-${targetRange.endLine} lines=${commentLines.length} hidden=${buckets.hiddenRanges.length} ` +
      `bold=${buckets.boldRanges.length} italic=${buckets.italicRanges.length} code=${buckets.codeRanges.length} ` +
      `strike=${buckets.strikeRanges.length} link=${buckets.linkRanges.length} fence=${buckets.fenceCodeRanges.length} ` +
      `list=${buckets.listGlyphOptions.length} table=${buckets.tableSeparatorRanges.length} (pipe=${buckets.tablePipeRanges.length},header=${buckets.tableHeaderRanges.length},pad=${buckets.tablePaddingOptions.length}) ` +
      `hr=${buckets.horizontalRuleOptions.length} bq=${buckets.blockquoteOptions.length} md=${isMarkdownFile}`
    );
  } catch (err) {
    log(`Error occurred during update: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

function getScanLineRange(editor: vscode.TextEditor): { startLine: number; endLine: number } {
  const doc = editor.document;
  if (doc.lineCount === 0) {
    return { startLine: 0, endLine: 0 };
  }

  if (editor.visibleRanges.length === 0) {
    const cursorLine = editor.selection.active.line;
    return {
      startLine: Math.max(0, cursorLine - VISIBLE_CONTEXT_LINES),
      endLine: Math.min(doc.lineCount - 1, cursorLine + VISIBLE_CONTEXT_LINES),
    };
  }

  let visibleStart = doc.lineCount - 1;
  let visibleEnd = 0;
  for (const range of editor.visibleRanges) {
    visibleStart = Math.min(visibleStart, range.start.line);
    visibleEnd = Math.max(visibleEnd, range.end.line);
  }

  return {
    startLine: Math.max(0, visibleStart - VISIBLE_CONTEXT_LINES),
    endLine: Math.min(doc.lineCount - 1, visibleEnd + VISIBLE_CONTEXT_LINES),
  };
}

export function deactivate() {
  log('Extension deactivated');
  decos?.dispose();
}

function wrapDocument(doc: vscode.TextDocument): TextDocumentLike {
  return {
    lineAt(line: number) {
      return doc.lineAt(line);
    },
    offsetAt(position) {
      return doc.offsetAt(new vscode.Position(position.line, position.character));
    },
    positionAt(offset: number) {
      return doc.positionAt(offset);
    },
  };
}





