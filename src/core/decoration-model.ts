import { SyntaxCategory } from '../highlight';

export interface TextSpan {
  start: number;
  end: number;
}

export interface ThemeColorRef {
  themeColor: string;
}

export interface AttachmentRenderSpec {
  contentText?: string;
  color?: string | ThemeColorRef;
  backgroundColor?: string | ThemeColorRef;
  textDecoration?: string;
  border?: string,
  borderColor?: string | ThemeColorRef,
  borderRadius?: string,
}

export interface DecorationRenderSpec {
  before?: AttachmentRenderSpec;
  after?: AttachmentRenderSpec;
}

export interface DecorationSpec {
  range: TextSpan;
  renderOptions?: DecorationRenderSpec;
}

export interface LinkSpec {
  range: TextSpan;
  url: string;
}

export interface DecorationBuckets {
  hiddenRanges: TextSpan[];
  boldRanges: TextSpan[];
  italicRanges: TextSpan[];
  boldItalicRanges: TextSpan[];
  codeRanges: DecorationSpec[];
  strikeRanges: TextSpan[];
  linkRanges: TextSpan[];
  headingRangesByLevel: TextSpan[][];
  fenceCodeRanges: DecorationSpec[];
  syntaxRanges: Record<SyntaxCategory, TextSpan[]>;
  listGlyphOptions: DecorationSpec[];
  horizontalRuleOptions: DecorationSpec[];
  blockquoteOptions: DecorationSpec[];
  tablePipeRanges: TextSpan[];
  tableSeparatorRanges: TextSpan[];
  tableHeaderRanges: TextSpan[];
  tablePaddingOptions: DecorationSpec[];
  tableTrailingWhitespaceRanges: TextSpan[];
  links: LinkSpec[];
}

export interface EditableLineRange {
  startLine: number;
  endLine: number;
}

export interface ScanOptions {
  hideMarkers: boolean;
  renderFencedCode: boolean;
  renderFencedCodeBackground: boolean;
  highlightFencedCode: boolean;
  renderLists: boolean;
  renderTables: boolean;
  renderBlockquotes: boolean;
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  hideMarkers: true,
  renderFencedCode: true,
  renderFencedCodeBackground: true,
  highlightFencedCode: true,
  renderLists: true,
  renderTables: true,
  renderBlockquotes: true,
};

export function createDecorationBuckets(): DecorationBuckets {
  return {
    hiddenRanges: [],
    boldRanges: [],
    italicRanges: [],
    boldItalicRanges: [],
    codeRanges: [],
    strikeRanges: [],
    linkRanges: [],
    headingRangesByLevel: Array.from({ length: 6 }, () => []),
    fenceCodeRanges: [],
    syntaxRanges: {
      keyword: [],
      function: [],
      string: [],
      number: [],
      comment: [],
    },
    listGlyphOptions: [],
    horizontalRuleOptions: [],
    blockquoteOptions: [],
    tablePipeRanges: [],
    tableSeparatorRanges: [],
    tableHeaderRanges: [],
    tablePaddingOptions: [],
    tableTrailingWhitespaceRanges: [],
    links: [],
  };
}

export function span(start: number, end: number): TextSpan {
  return { start, end };
}

export function themeColor(themeColor: string): ThemeColorRef {
  return { themeColor };
}
