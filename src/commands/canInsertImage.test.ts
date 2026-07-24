import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toLive } from '../views/ViewSync';
import { toLiveHtml } from '../views/htmlModel';
import { liveSchema } from '../views/liveSchema';
import { htmlSchema } from '../views/htmlSchema';
import { canInsertImage as mdCanInsertImage } from './markdownInlineCommands';
import { canInsertImage as htmlCanInsertImage } from './htmlInlineCommands';

/** Build a live (Markdown) EditorState from source, cursor at `pos`. */
function mdStateAt(src: string, pos: number): EditorState {
  const r = toLive(src, null);
  if (!r.ok) throw new Error('toLive should be ok');
  const s = EditorState.create({ doc: r.doc, schema: liveSchema });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));
}

/** Build an HTML-live EditorState from source, cursor at `pos`. */
function htmlStateAt(src: string, pos: number): EditorState {
  const r = toLiveHtml(src, null);
  if (!r.ok) throw new Error('toLiveHtml should be ok');
  const s = EditorState.create({ doc: r.doc, schema: htmlSchema });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));
}

describe('canInsertImage (Markdown)', () => {
  it('is true with the cursor in a paragraph', () => {
    expect(mdCanInsertImage(mdStateAt('hello world\n', 1))).toBe(true);
  });
  it('is false with the cursor inside a fenced code block', () => {
    expect(mdCanInsertImage(mdStateAt('```\ncode here\n```\n', 1))).toBe(false);
  });
});

describe('canInsertImage (HTML)', () => {
  it('is true with the cursor in a paragraph', () => {
    expect(htmlCanInsertImage(htmlStateAt('<p>hello world</p>', 1))).toBe(true);
  });
  it('is false with the cursor inside a code block', () => {
    expect(htmlCanInsertImage(htmlStateAt('<pre><code>code here</code></pre>', 1))).toBe(false);
  });
});
