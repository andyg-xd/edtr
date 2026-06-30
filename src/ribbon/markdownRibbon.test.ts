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
const byId = (id: string) => markdownRibbon.find((c) => c.id === id)!;

describe('markdownRibbon', () => {
  it('has the 6 inline controls in order', () => {
    expect(markdownRibbon.map((c) => c.id)).toEqual(['bold', 'italic', 'strike', 'code', 'link', 'image']);
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
