/**
 * Whether a code block is a text diagram that must not wrap.
 *
 * Two or more lines containing a box-drawing character (U+2500–U+257F) mark
 * the block as a diagram. One separator line does not: a rule like `// ────`
 * above real code is common and is not a picture.
 */
const BOX_DRAWING = /[─-╿]/;

export function isTextDiagram(text: string): boolean {
  let count = 0;
  for (const line of text.split('\n')) {
    if (BOX_DRAWING.test(line) && ++count >= 2) return true;
  }
  return false;
}
