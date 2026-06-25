export interface CommentSyntax {
  line?: string[];
  block?: Array<[string, string]>;
}

export interface CommentBlockState {
  inBlock: boolean;
  activeBlockClose: string;
}

export interface PositionLike {
  line: number;
  character: number;
}

export interface TextDocumentLike {
  lineAt(line: number): { text: string };
  offsetAt(position: PositionLike): number;
  positionAt(offset: number): PositionLike;
}

export interface CommentLine {
  start: number;
  text: string;
}