import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';
import { toggleStrong } from '../commands/markdownInlineCommands';
import { markdownRibbon } from './markdownRibbon';

function stateOf(src: string): EditorState {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return EditorState.create({ doc: r.doc, schema: liveSchema });
}
function selectFirstBlock(s: EditorState): EditorState {
  const b = s.doc.child(0);
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 1 + b.content.size)));
}
function cursorAt(s: EditorState, pos: number): EditorState {
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos, pos)));
}
function cursorInBlock(s: EditorState, blockIndex: number): EditorState {
  let pos = 1;
  for (let i = 0; i < blockIndex; i++) pos += s.doc.child(i).nodeSize;
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos, pos)));
}
const byId = (id: string) => markdownRibbon.find((c) => c.id === id)!;

describe('markdownRibbon', () => {
  it('has the 6 inline controls in order', () => {
    expect(markdownRibbon.slice(0, 6).map((c) => c.id)).toEqual(['bold', 'italic', 'strike', 'code', 'link', 'image']);
  });
  it('every control has an aria-label and a glyph label', () => {
    for (const c of markdownRibbon) {
      expect(c.ariaLabel.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
  it('bold isActive reflects the selection marks', () => {
    let s = selectFirstBlock(stateOf('hello\n'));
    expect(byId('bold').isActive(s)).toBe(false);
    toggleStrong(s, (tr) => { s = s.apply(tr); });
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 1 + s.doc.child(0).content.size)));
    expect(byId('bold').isActive(s)).toBe(true);
  });
  it('bold isEnabled is false inside a code block', () => {
    expect(byId('bold').isEnabled(cursorAt(stateOf('```\nx\n```\n'), 2))).toBe(false);
    expect(byId('bold').isEnabled(selectFirstBlock(stateOf('hello\n')))).toBe(true);
  });
  it('image isEnabled is false inside a code block, true in a paragraph', () => {
    expect(byId('image').isEnabled(cursorAt(stateOf('```\nx\n```\n'), 2))).toBe(false);
    expect(byId('image').isEnabled(cursorAt(stateOf('hi\n'), 2))).toBe(true);
  });
  it('link is a popover control with a removeLink whenActiveRun and an applyLink builder', () => {
    const link = byId('link');
    expect(link.action.kind).toBe('popover');
    if (link.action.kind === 'popover') {
      expect(link.action.popover).toBe('link');
      expect(typeof link.action.whenActiveRun).toBe('function');
      expect(typeof link.action.buildCommand).toBe('function');
    }
  });
  it('image is a popover control with no whenActiveRun', () => {
    const image = byId('image');
    expect(image.action.kind).toBe('popover');
    if (image.action.kind === 'popover') {
      expect(image.action.popover).toBe('image');
      expect(image.action.whenActiveRun).toBeUndefined();
    }
  });
});

describe('markdownRibbon — block controls', () => {
  it('has 13 controls in order (6 inline + 7 block)', () => {
    expect(markdownRibbon.map((c) => c.id)).toEqual([
      'bold', 'italic', 'strike', 'code', 'link', 'image',
      'heading', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'horizontalRule',
    ]);
  });
  it('heading is a dropdown with Paragraph + H1–H6 and reports the current level', () => {
    const h = byId('heading');
    expect(h.action.kind).toBe('dropdown');
    if (h.action.kind === 'dropdown') {
      expect(h.action.options.map((o) => o.value)).toEqual(['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
      expect(h.action.getValue(cursorInBlock(stateOf('## t\n'), 0))).toBe('h2');
      expect(h.action.getValue(cursorInBlock(stateOf('p\n'), 0))).toBe('paragraph');
    }
  });
  it('codeBlock / blockquote / list controls reflect active state', () => {
    expect(byId('codeBlock').isActive(cursorInBlock(stateOf('```\nx\n```\n'), 0))).toBe(true);
    expect(byId('blockquote').isActive(cursorInBlock(stateOf('> q\n'), 0))).toBe(true);
    expect(byId('bulletList').isActive(cursorInBlock(stateOf('- a\n'), 0))).toBe(true);
  });
  it('block controls are disabled in a verbatim block', () => {
    const s = stateOf('| a | b |\n| - | - |\n| 1 | 2 |\n');
    const sel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 0, 0)));
    expect(byId('codeBlock').isEnabled(sel)).toBe(false);
  });
  it('includes a horizontal-rule command control', () => {
    const hr = markdownRibbon.find((c) => c.id === 'horizontalRule');
    expect(hr).toBeDefined();
    expect(hr!.action.kind).toBe('command');
    expect(hr!.ariaLabel).toBe('Horizontal rule');
  });
});
