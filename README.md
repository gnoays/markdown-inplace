# Markdown InPlace

Markdown InPlace makes Markdown-style code comments easier to read directly in the editor. It styles Markdown syntax in source comments, doc comments, and Markdown files without opening a separate preview pane.

It is built for notes that live next to code: explanations, TODOs, API docs, design notes, and lightweight Markdown where staying in the editor matters more than full Markdown rendering.

[![GitHub Release](https://img.shields.io/github/v/release/gnoays/markdown-inplace?label=Release&logo=github)](https://github.com/gnoays/markdown-inplace/releases)
[![Open VSX Version](https://img.shields.io/open-vsx/v/gnoays/markdown-inplace)](https://open-vsx.org/extension/gnoays/markdown-inplace)
[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-install-007ACC)](https://marketplace.visualstudio.com/items?itemName=gnoays.markdown-inplace)
[![CI](https://github.com/gnoays/markdown-inplace/actions/workflows/ci.yml/badge.svg)](https://github.com/gnoays/markdown-inplace/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/gnoays/markdown-inplace)](LICENSE)

## What It Does

- Treats code comments as Markdown content across supported languages.
- Styles emphasis, inline code, headings, links, lists, blockquotes, tables, horizontal rules, and fenced code blocks in place.
- Soft-hides Markdown markers such as `**`, `*`, `` ` ``, `~~`, and heading `#`, while showing them on the cursor line for editing.
- Lets you turn marker hiding on or off with `markdownInplace.hideMarkers`.
- Also decorates `.md` files when `markdownInplace.renderMarkdownFile` is enabled.
- Opens Markdown links and shows hover previews for images and local Markdown links.

## Examples

| Markdown | In-place behavior |
| --- | --- |
| `**bold**`, `*italic*`, `~~deleted~~` | Styled text with markers hidden outside the cursor line |
| `` `code` `` | Inline code styling with background |
| `# Heading` | Larger bold heading text |
| `[text](./README.md#examples)` | Link styling, navigation, and local section hover |
| `![alt](./icon.png)` | Inline image marker plus image hover preview |
| `- [x] item` | Checkbox-style list marker |
| `> quote` | Blockquote bar |
| Markdown table | Column-aligned display in monospace editors |
| Fenced code block | Code background and syntax highlighting |

## Links and Hovers

Links support absolute URLs, `mailto:`, relative files, and heading anchors such as `#section` or `./docs.md#section`. Heading anchors use GitHub-style slugs.

Hover behavior:

- `[](./README.md)` shows the beginning of the workspace Markdown file.
- `[](./README.md#links-and-hovers)` shows the target Markdown section.
- `[](#usage)` shows the target section in the current file.
- `![alt](./icon.png)` shows an image preview.
- `[![alt](./icon.png)](./README.md)` shows the image preview when hovering the image, and the link preview when hovering the rest of the link text.

## Supported Scope

Markdown InPlace intentionally supports a practical Markdown subset for editor decoration. It is not a full CommonMark preview engine.

Not currently supported:

- Reference links such as `[text][ref]`
- Footnotes
- Bare URL autolinking
- Math rendering
- Mermaid or other diagrams
- Inline HTML rendering

Unsupported syntax is left as plain text.

## Settings

Most behavior is controlled through `markdownInplace.*` settings. Common toggles include:

- `markdownInplace.enabled`
- `markdownInplace.hideMarkers`
- `markdownInplace.renderMarkdownFile`
- `markdownInplace.renderInlineImages`
- `markdownInplace.renderImageHover`
- `markdownInplace.renderLinkHover`
- `markdownInplace.renderTables`
- `markdownInplace.renderFencedCode`

The command palette also includes:

- `Toggle Markdown InPlace`
- `Toggle Marker Hiding (Markdown InPlace)`
- `Toggle Markdown File Rendering (Markdown InPlace)`

## Notes

- Table alignment assumes a monospace editor font.
- The display language follows the editor UI language when available.

## License

MIT License. See [LICENSE](LICENSE).
