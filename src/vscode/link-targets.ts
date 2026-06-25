import * as vscode from 'vscode';
import { findHeadingLineBySlug } from '../core';

const DEFAULT_ALLOWED_URI_SCHEMES = ['file', 'http', 'https', 'mailto'] as const;

export interface ResolveLinkTargetOptions {
  allowedSchemes?: readonly string[];
}

function isAllowedScheme(scheme: string, allowedSchemes: readonly string[]): boolean {
  return allowedSchemes.some((allowed) => allowed.toLowerCase() === scheme.toLowerCase());
}

export async function readDocumentText(uri: vscode.Uri): Promise<string | undefined> {
  const key = uri.toString();
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
  if (open) return open.getText();
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return undefined;
  }
}

export async function resolveLinkTarget(
  document: vscode.TextDocument,
  dest: string,
  options: ResolveLinkTargetOptions = {}
): Promise<vscode.Uri | undefined> {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(dest)) {
    try {
      const uri = vscode.Uri.parse(dest, true);
      const allowedSchemes = options.allowedSchemes ?? DEFAULT_ALLOWED_URI_SCHEMES;
      return isAllowedScheme(uri.scheme, allowedSchemes) ? uri : undefined;
    } catch {
      return undefined;
    }
  }

  const hashIndex = dest.indexOf('#');
  const pathPart = hashIndex === -1 ? dest : dest.slice(0, hashIndex);
  const anchorRaw = hashIndex === -1 ? '' : dest.slice(hashIndex + 1);
  let anchor = anchorRaw;
  try {
    anchor = decodeURIComponent(anchorRaw);
  } catch {
    // Treat invalid % encoding as the original string
  }
  const queryIndex = pathPart.search(/[?]/);
  const cleanPath = queryIndex === -1 ? pathPart : pathPart.slice(0, queryIndex);
  let targetUri: vscode.Uri;
  let bodyText: string | undefined;

  if (cleanPath.length === 0) {
    if (anchor.length === 0) return undefined;
    targetUri = document.uri;
    bodyText = document.getText();
  } else {
    try {
      targetUri = vscode.Uri.joinPath(document.uri, '..', cleanPath);
    } catch {
      return undefined;
    }
  }

  if (anchor.length === 0) return targetUri;
  bodyText = bodyText ?? await readDocumentText(targetUri);
  if (!bodyText) return targetUri;

  const line = findHeadingLineBySlug(bodyText, anchor);
  if (line !== undefined) return targetUri.with({ fragment: `L${line + 1}` });

  return cleanPath.length === 0 ? undefined : targetUri;
}
