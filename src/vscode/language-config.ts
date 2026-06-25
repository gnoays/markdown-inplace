import * as vscode from 'vscode';
import {
  CommentSyntax,
  parseJsonc,
  setDynamicCommentSyntax,
  syntaxFromComments,
} from '../core';

export async function loadLanguageConfigurations(log: (message: string) => void): Promise<void> {
  const map = new Map<string, CommentSyntax>();

  for (const ext of vscode.extensions.all) {
    const languages = ext.packageJSON?.contributes?.languages;
    if (!Array.isArray(languages)) continue;

    for (const lang of languages) {
      if (!lang || typeof lang.id !== 'string' || typeof lang.configuration !== 'string') continue;
      if (map.has(lang.id)) continue;

      try {
        const uri = vscode.Uri.joinPath(ext.extensionUri, lang.configuration);
        const raw = await vscode.workspace.fs.readFile(uri);
        const conf = parseJsonc(Buffer.from(raw).toString('utf8')) as { comments?: unknown };
        const syntax = syntaxFromComments(conf.comments);
        if (syntax) {
          map.set(lang.id, syntax);
        }
      } catch (err) {
        log(`Failed to load language-configuration (${lang.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  setDynamicCommentSyntax(map);
  log(`Dynamically loaded language-configuration: ${map.size} entries`);
}
