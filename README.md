# Markdown InPlace

Renders Markdown syntax **in place inside the editor** — in code comments (`// ...`, `# ...`, `/* ... */`, etc.) and `.md` files — without opening a separate preview pane.

## Supported Syntax

| Syntax | Rendered as |
| --- | --- |
| `**bold**` `__bold__` | **bold** |
| `*italic*` `_italic_` | *italic* |
| `***bold italic***` | ***bold + italic*** |
| `` `code` `` | monospace + background |
| `~~strikethrough~~` | strikethrough |
| `# Heading` … `###### Heading` | scaled + bold (optional uppercase) |
| `[text](URL)` | link color + underline, Ctrl+click to open (supports relative paths `./foo.md`, heading anchors `#section`, `./foo.md#section`, and titled links `(URL "title")`) |
| `---` `***` `___` | horizontal rule |
| `- item` / `1. item` | bullet / numbered list |
| `- [ ]` / `- [x]` | task list (checkbox) |
| `> quote` | left-edge vertical bar |
| Markdown table | column-aligned display (assumes monospace font) |
| ` ```lang ` fenced code block | code background + syntax highlighting |

Rust doc comments (`///`, `//!`, `/** ... */`, `/*! ... */`) are treated as Markdown body.  
In `.md` files, the entire file is decorated — not just comments (`markdownInplace.renderMarkdownFile`, default ON).

## Unsupported Syntax

Due to the nature of inline editor rendering, the following are displayed as **plain text**:

| Syntax | Status |
| --- | --- |
| Images `![alt](url)` | Partial — no inline image display, but hover shows a preview (`markdownInplace.hoverImageMaxWidth`, default 300 px) |
| Mermaid / diagrams (` ```mermaid `) | Not supported (rendered as a code block) |
| Math (LaTeX `$...$` / `$$...$$`) | Not supported |
| Inline HTML (`<div>` etc.) | Not supported (shown as-is) |
| Footnotes `[^1]` / reference links `[text][ref]` | Not supported |
| Bare URL auto-linking | Not supported (`[text](URL)` form only) |

## Visual Behavior

- **Marker hiding**: Markers such as `**`, `*`, `` ` ``, `~~`, `#` are visually hidden by default (`markdownInplace.hideMarkers`).  
  Markers on the **cursor line are always shown** for easy editing.
- **Headings**: Font size scales across 6 levels (h1–h6) with bold styling.  
  `markdownInplace.headingUppercase` (default OFF) enables uppercase display.
- **Links**: Only the `text` part of `[text](url)` is colored and underlined.  
  `Ctrl+click` (or `Cmd+click` on Mac) opens the target. Absolute URLs (`http(s)`, `mailto`), relative paths (`./foo.md`, `../bar.ts`), and heading anchors (`#section`, `./foo.md#section`) are all supported. GitHub-style slugs are used to resolve heading targets.
- **Fenced code blocks**: Opening and closing fences are not hidden; only body lines get a code background.  
  A virtual trailing space is added to short lines to approximate the block's full width.  
  Disable with `markdownInplace.renderFencedCodeBackground` (default ON).
- **Tables**: Detects `| name | value |` + `| --- | --- |` format and adds virtual padding to align columns.  
  Lines under the cursor or selection retain near-raw display for easy editing.

## Known Limitations

- Table column alignment assumes a monospace font. If columns look misaligned, disable with `markdownInplace.renderTables`.

## Commands

Open the Command Palette (`Ctrl+Shift+P`) to toggle features. All other settings are available under `markdownInplace.*` in VS Code settings.

- `Toggle Markdown InPlace` — enable / disable the extension
- `Toggle Marker Hiding (Markdown InPlace)` — show / hide `**`, `*`, `` ` `` etc.
- `Toggle Markdown File Rendering (Markdown InPlace)` — enable / disable decoration of `.md` files

The display language (English / Japanese / Chinese) follows VS Code's UI language.

## License

MIT License — see the [LICENSE](LICENSE) file. Copyright (c) 2026 gnoays.
