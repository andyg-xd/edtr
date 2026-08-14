/**
 * The exported document's stylesheet (6c-iii, D5).
 *
 * Deliberately self-contained and literal: NO `var(--…)` tokens and NO
 * bundled fonts. Edtr's tokens describe Edtr's canvas and its themes; this
 * file is opened in someone else's browser, on a machine that has neither.
 * Always light, because a dark PDF is unusable on paper.
 */
export const EXPORT_STYLES = `
@page { size: letter; margin: 20mm; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0 auto; padding: 24px; max-width: 46em;
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  color: #1a1a1a; background: #ffffff;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
a { color: #0b5cad; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
pre { padding: 12px 14px; background: #f5f5f5; border-radius: 6px; overflow-x: auto; }
pre code { font-size: 0.88em; }
blockquote { padding-left: 1em; border-left: 3px solid #d4d4d4; color: #444; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d4d4d4; padding: 6px 10px; text-align: left; }
th { background: #f5f5f5; }
img { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid #d4d4d4; margin: 2em 0; }
@media print {
  body { padding: 0; max-width: none; }
  h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
  pre, blockquote, table, img { break-inside: avoid; page-break-inside: avoid; }
}
`.trim();
