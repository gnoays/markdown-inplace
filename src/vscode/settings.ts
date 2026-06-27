import * as vscode from 'vscode';

export type Settings = {
  enabled: boolean;
  hideMarkers: boolean;
  headingUppercase: boolean;
  renderFencedCode: boolean;
  renderFencedCodeBackground: boolean;
  fencedCodeFullWidth: boolean;
  highlightFencedCode: boolean;
  renderLists: boolean;
  renderTables: boolean;
  renderBlockquotes: boolean;
  renderMarkdownFile: boolean;
  renderInlineImages: boolean;
  renderImageHover: boolean;
  renderLinkHover: boolean;
  hoverImageMaxWidth: number;
  languages: string[];
};

export type BoolKey = Exclude<keyof Settings, 'languages' | 'hoverImageMaxWidth'>;
export type Recreate = 'heading' | 'fence';

type BoolDef = {
  key: BoolKey;
  default: boolean;
  command?: string;
  message?: string;
  recreate?: Recreate;
};

type ArrayDef = {
  key: 'languages';
  default: string[];
};

type NumberDef = {
  key: 'hoverImageMaxWidth';
  default: number;
  recreate?: Recreate;
};

export const SETTING_DEFS = [
  { key: 'enabled',            default: true,  command: 'markdownInplace.toggle',                     message: 'Markdown InPlace: {0}' },
  { key: 'hideMarkers',        default: true,  command: 'markdownInplace.toggleHideMarkers',          message: 'Marker hiding: {0}' },
  { key: 'headingUppercase',   default: false, recreate: 'heading' },
  { key: 'renderFencedCode',   default: true },
  { key: 'renderFencedCodeBackground', default: true, recreate: 'fence' },
  { key: 'fencedCodeFullWidth',default: false, recreate: 'fence' },
  { key: 'highlightFencedCode',default: true },
  { key: 'renderLists',        default: true },
  { key: 'renderTables',       default: true },
  { key: 'renderBlockquotes',  default: true },
  { key: 'renderMarkdownFile', default: true,  command: 'markdownInplace.toggleMarkdownFile',        message: 'Whole Markdown file decoration: {0}' },
  { key: 'renderInlineImages', default: true },
  { key: 'renderImageHover',   default: true },
  { key: 'renderLinkHover',    default: true },
  { key: 'hoverImageMaxWidth', default: 300 },
  { key: 'languages',          default: [] },
] as const satisfies readonly (BoolDef | ArrayDef | NumberDef)[];

function equals(a: any, b: any): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export function readSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration('markdownInplace');
  const out = {} as Settings;
  for (const d of SETTING_DEFS) {
    (out as any)[d.key] = cfg.get(d.key, d.default as any) as any;
  }
  return out;
}

export function registerToggleCommands(
  ctx: vscode.ExtensionContext,
  settings: Settings,
  onChange: (recreate?: Recreate) => void,
  log?: (message: string) => void
) {
  for (const d of SETTING_DEFS) {
    if (!('command' in d) || !d.command) continue;
    ctx.subscriptions.push(
      vscode.commands.registerCommand(d.command, () => {
        const key = d.key as BoolKey;
        settings[key] = !settings[key];
        vscode.window.showInformationMessage(
          vscode.l10n.t(d.message!, settings[key] ? 'ON' : 'OFF')
        );
        if (log) {
          log(`Command ${d.command.split('.').pop()} executed: ${key}=${settings[key]}`);
        }
        onChange(('recreate' in d) ? (d as any).recreate as Recreate : undefined);
      })
    );
  }
}

export function applyConfigChange(
  settings: Settings,
  onChange: (recreate?: Recreate) => void,
  log?: (message: string) => void
): boolean {
  const next = readSettings();
  let dirty = false;
  for (const d of SETTING_DEFS) {
    const key = d.key;
    if (equals(settings[key], next[key])) continue;
    (settings as any)[key] = next[key];
    if (log) {
      log(`Configuration change detected: ${key}=${Array.isArray(next[key]) ? JSON.stringify(next[key]) : next[key]}`);
    }
    onChange(('recreate' in d) ? d.recreate : undefined);
    dirty = true;
  }
  return dirty;
}
