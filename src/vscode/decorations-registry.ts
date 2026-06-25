import * as vscode from 'vscode';
import { Settings, Recreate } from './settings';
import { SyntaxCategory } from '../highlight';

const STATIC_DECOS = {
  hidden: { textDecoration: 'none; font-size: 0; letter-spacing: 0;', fontStyle: 'normal', fontWeight: 'normal' },
  bold: { fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  boldItalic: { fontWeight: 'bold', fontStyle: 'italic' },
  code: {
    backgroundColor: new vscode.ThemeColor('markdownInplace.codeSpanBackground'),
    borderRadius: '3px',
  },
  strike: { textDecoration: 'line-through' },
  link: {
    color: new vscode.ThemeColor('markdownInplace.linkForeground'),
    textDecoration: 'underline; cursor: pointer;',
  },
  listGlyph: {
    textDecoration: 'none; font-size: 0; letter-spacing: 0;',
    before: {
      color: new vscode.ThemeColor('markdownInplace.descriptionForeground'),
    },
  },
  horizontalRule: {
    before: {
      color: new vscode.ThemeColor('markdownInplace.descriptionForeground'),
    },
  },
  blockquote: {
    before: {
      color: new vscode.ThemeColor('markdownInplace.blockquoteBorder'),
    },
  },
  tablePipe: { color: new vscode.ThemeColor('markdownInplace.descriptionForeground') },
  tableSeparator: { color: new vscode.ThemeColor('markdownInplace.descriptionForeground') },
  tableHeader: { fontWeight: 'bold' },
  tablePadding: {},
  tableTrailingWhitespace: { textDecoration: 'none; font-size: 0; letter-spacing: 0;' },
} satisfies Record<string, vscode.DecorationRenderOptions>;

export class Decorations {
  private types = new Map<string, vscode.TextEditorDecorationType>();
  headings!: vscode.TextEditorDecorationType[];
  fence!: vscode.TextEditorDecorationType;
  syntax!: Record<SyntaxCategory, vscode.TextEditorDecorationType>;

  constructor(private s: Settings) {
    for (const [name, opts] of Object.entries(STATIC_DECOS)) {
      this.types.set(name, vscode.window.createTextEditorDecorationType(opts));
    }
    this.recreate('heading');
    this.recreate('fence');
    
    this.syntax = {
      keyword: vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor('markdownInplace.syntaxKeyword') }),
      function: vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor('markdownInplace.syntaxFunction') }),
      string: vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor('markdownInplace.syntaxString') }),
      number: vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor('markdownInplace.syntaxNumber') }),
      comment: vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor('markdownInplace.syntaxComment') }),
    };
  }

  get(name: keyof typeof STATIC_DECOS): vscode.TextEditorDecorationType {
    return this.types.get(name)!;
  }

  recreate(which?: Recreate) {
    if (!which || which === 'heading') {
      if (this.headings) {
        this.headings.forEach((d) => d.dispose());
      }
      this.headings = this.createHeadingDecos();
    }
    if (!which || which === 'fence') {
      if (this.fence) {
        this.fence.dispose();
      }
      this.fence = this.createFenceCodeDeco();
    }
  }

  getAllTypes(): vscode.TextEditorDecorationType[] {
    return [
      ...this.types.values(),
      ...this.headings,
      this.fence,
      ...Object.values(this.syntax)
    ];
  }

  dispose() {
    for (const deco of this.types.values()) {
      deco.dispose();
    }
    this.types.clear();
    if (this.headings) {
      this.headings.forEach((d) => d.dispose());
    }
    if (this.fence) {
      this.fence.dispose();
    }
    if (this.syntax) {
      for (const deco of Object.values(this.syntax)) {
        deco.dispose();
      }
    }
  }

  private createFenceCodeDeco(): vscode.TextEditorDecorationType {
    const opts: vscode.DecorationRenderOptions = {
      isWholeLine: this.s.fencedCodeFullWidth,
    };
    if (this.s.renderFencedCodeBackground) {
      opts.backgroundColor = new vscode.ThemeColor('markdownInplace.codeBlockBackground');
    }
    return vscode.window.createTextEditorDecorationType(opts);
  }

  private createHeadingDecos(): vscode.TextEditorDecorationType[] {
    const headingSizes = [1.4, 1.3, 1.2, 1.15, 1.1, 1.05]; // h1..h6
    return headingSizes.map((size) =>
      vscode.window.createTextEditorDecorationType({
        fontWeight: 'bold',
        textDecoration: `none; font-size: ${size}em;${this.s.headingUppercase ? ' text-transform: uppercase;' : ''}`,
      })
    );
  }
}
