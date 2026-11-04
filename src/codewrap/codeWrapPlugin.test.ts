import { describe, it, expect } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { history, undoDepth } from 'prosemirror-history';
import { buildLiveDoc } from '../views/liveModel';
import { liveSchema } from '../views/liveSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from '../views/dirtyTracking';
import {
  blockWraps, codeWrapKey, codeWrapPlugin, toggleCodeWrapAt, toggleCodeWrapAtCaret,
} from './codeWrapPlugin';

const SOURCE = [
  'Intro paragraph.',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '```',
  '┌──┐',
  '└──┘',
  '```',
  '',
  '- item',
  '',
  '  ```',
  '  in list',
  '  ```',
  '',
  '> quote',
  '>',
  '> ```',
  '> in quote',
  '> ```',
  '',
].join('\n');

function stateFor(source: string): EditorState {
  const r = buildLiveDoc(source);
  if (!r.ok) throw new Error(`fixture degraded: ${r.reason}`);
  return EditorState.create({
    doc: r.doc,
    plugins: [history(), dirtyTrackingPlugin(), codeWrapPlugin()],
  });
}

function codeBlocks(doc: PMNode): number[] {
  const out: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') out.push(pos);
    return true;
  });
  return out;
}

function run(state: EditorState, cmd: Command) {
  let next = state;
  const ok = cmd(state, (tr) => { next = state.apply(tr); });
  return { ok, next };
}

/** The class a block's decoration carries. `attrs` is not public API, so read it through a cast. */
function classAt(state: EditorState, pos: number): string | null {
  const set = codeWrapKey.getState(state)!.decorations;
  const node = state.doc.nodeAt(pos)!;
  const [deco] = set.find(pos, pos + node.nodeSize).filter((d) => d.from === pos);
  return deco ? (deco as unknown as { type: { attrs: { class: string } } }).type.attrs.class : null;
}

describe('codeWrapPlugin', () => {
  it('wraps an ordinary block and leaves a text diagram unwrapped', () => {
    const state = stateFor(SOURCE);
    const [js, diagram] = codeBlocks(state.doc);
    expect(blockWraps(state, js)).toBe(true);
    expect(blockWraps(state, diagram)).toBe(false);
    expect(classAt(state, js)).toBe('edtr-code edtr-wrap');
    expect(classAt(state, diagram)).toBe('edtr-code edtr-nowrap');
  });

  it('flips a block, and flips it back on a second toggle', () => {
    const state = stateFor(SOURCE);
    const [js] = codeBlocks(state.doc);
    const once = run(state, toggleCodeWrapAt(js));
    expect(once.ok).toBe(true);
    expect(blockWraps(once.next, js)).toBe(false);
    expect(classAt(once.next, js)).toBe('edtr-code edtr-nowrap');
    const twice = run(once.next, toggleCodeWrapAt(js));
    expect(blockWraps(twice.next, js)).toBe(true);
  });

  it('changes nothing in the document: no step, no dirty block, no undo step', () => {
    const state = stateFor(SOURCE);
    const [js] = codeBlocks(state.doc);
    let tr: Transaction | null = null;
    toggleCodeWrapAt(js)(state, (t) => { tr = t; });
    expect(tr).not.toBeNull();
    expect(tr!.docChanged).toBe(false);
    const next = state.apply(tr!);
    expect(next.doc).toBe(state.doc);
    expect(getDirtyBlockIds(next).size).toBe(0);
    expect(undoDepth(next)).toBe(undoDepth(state));
  });

  it('decorates and toggles a code block inside a list item and inside a blockquote', () => {
    const state = stateFor(SOURCE);
    const [, , inList, inQuote] = codeBlocks(state.doc);
    expect(state.doc.resolve(inList).parent.type.name).toBe('listItem');
    expect(state.doc.resolve(inQuote).parent.type.name).toBe('blockquote');
    expect(classAt(state, inList)).toBe('edtr-code edtr-wrap');
    expect(classAt(state, inQuote)).toBe('edtr-code edtr-wrap');
    const a = run(state, toggleCodeWrapAt(inList)).next;
    const b = run(a, toggleCodeWrapAt(inQuote)).next;
    expect(blockWraps(b, inList)).toBe(false);
    expect(blockWraps(b, inQuote)).toBe(false);
    expect(classAt(b, inQuote)).toBe('edtr-code edtr-nowrap');
  });

  it('keeps a flip on its block when text is typed above it', () => {
    const state = stateFor(SOURCE);
    const [js] = codeBlocks(state.doc);
    const flipped = run(state, toggleCodeWrapAt(js)).next;
    const typed = flipped.apply(flipped.tr.insertText('more words ', 1));
    const [jsAfter] = codeBlocks(typed.doc);
    expect(jsAfter).toBe(js + 'more words '.length);
    expect(blockWraps(typed, jsAfter)).toBe(false);
    expect(classAt(typed, jsAfter)).toBe('edtr-code edtr-nowrap');
  });

  it('gives a new block at a deleted block’s position the defaults, without throwing', () => {
    const state = stateFor(SOURCE);
    const [js] = codeBlocks(state.doc);
    const flipped = run(state, toggleCodeWrapAt(js)).next;
    const size = flipped.doc.nodeAt(js)!.nodeSize;
    const deleted = flipped.apply(flipped.tr.delete(js, js + size));
    const fresh = liveSchema.node('codeBlock', null, [liveSchema.text('new code')]);
    const inserted = deleted.apply(deleted.tr.insert(js, fresh));
    expect(inserted.doc.nodeAt(js)!.textContent).toBe('new code');
    expect(blockWraps(inserted, js)).toBe(true);
    expect(classAt(inserted, js)).toBe('edtr-code edtr-wrap');

    // The same replacement in ONE transaction must not inherit the flip either.
    const replaced = flipped.apply(flipped.tr.replaceWith(js, js + size, fresh));
    expect(blockWraps(replaced, js)).toBe(true);
  });

  it('drops a flip when its block stops being a code block', () => {
    const state = stateFor(SOURCE);
    const [js] = codeBlocks(state.doc);
    const flipped = run(state, toggleCodeWrapAt(js)).next;
    const para = flipped.apply(flipped.tr.setBlockType(js + 1, js + 1, liveSchema.nodes.paragraph));
    expect(para.doc.nodeAt(js)!.type.name).toBe('paragraph');
    expect(codeWrapKey.getState(para)!.overrides.size).toBe(0);
  });

  it('toggles the caret’s block, and does nothing with the caret in a paragraph', () => {
    const state = stateFor(SOURCE);
    const [js] = codeBlocks(state.doc);
    const inPara = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
    expect(toggleCodeWrapAtCaret(inPara)).toBe(false);
    expect(run(inPara, toggleCodeWrapAtCaret).ok).toBe(false);

    const inCode = inPara.apply(inPara.tr.setSelection(TextSelection.create(inPara.doc, js + 3)));
    const toggled = run(inCode, toggleCodeWrapAtCaret);
    expect(toggled.ok).toBe(true);
    expect(blockWraps(toggled.next, js)).toBe(false);
  });

  it('toggles the block showing its label when a selection spans blocks: the one holding the head', () => {
    const state = stateFor(SOURCE);
    const [js, diagram] = codeBlocks(state.doc);
    const caretIn = (s: EditorState) =>
      codeBlocks(s.doc).filter((p) => classAt(s, p)!.includes('edtr-caret-in'));
    const flipped = (before: EditorState, after: EditorState) =>
      codeBlocks(before.doc).filter((p) => blockWraps(before, p) !== blockWraps(after, p));

    // Paragraph → code: the head is in the code block, so it shows its label and ⌥Z flips it.
    const intoCode = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, js + 3)));
    expect(caretIn(intoCode)).toEqual([js]);
    const a = run(intoCode, toggleCodeWrapAtCaret);
    expect(a.ok).toBe(true);
    expect(flipped(intoCode, a.next)).toEqual(caretIn(intoCode));

    // Code → paragraph: the head is in the paragraph, so no label shows and ⌥Z flips nothing.
    const outOfCode = state.apply(state.tr.setSelection(TextSelection.create(state.doc, js + 3, 2)));
    expect(caretIn(outOfCode)).toEqual([]);
    const b = run(outOfCode, toggleCodeWrapAtCaret);
    expect(b.ok).toBe(false);
    expect(flipped(outOfCode, b.next)).toEqual([]);

    // Code → code: the head's block, not the anchor's.
    const across = state.apply(state.tr.setSelection(TextSelection.create(state.doc, js + 3, diagram + 2)));
    expect(caretIn(across)).toEqual([diagram]);
    const c = run(across, toggleCodeWrapAtCaret);
    expect(flipped(across, c.next)).toEqual([diagram]);
  });

  it('marks only the block holding the caret with edtr-caret-in, and follows the caret', () => {
    const state = stateFor(SOURCE);
    const [js, diagram] = codeBlocks(state.doc);
    const inJs = state.apply(state.tr.setSelection(TextSelection.create(state.doc, js + 2)));
    expect(classAt(inJs, js)).toBe('edtr-code edtr-wrap edtr-caret-in');
    expect(classAt(inJs, diagram)).toBe('edtr-code edtr-nowrap');

    const inDiagram = inJs.apply(inJs.tr.setSelection(TextSelection.create(inJs.doc, diagram + 2)));
    expect(classAt(inDiagram, js)).toBe('edtr-code edtr-wrap');
    expect(classAt(inDiagram, diagram)).toBe('edtr-code edtr-nowrap edtr-caret-in');

    const out = inDiagram.apply(inDiagram.tr.setSelection(TextSelection.create(inDiagram.doc, 2)));
    expect(classAt(out, diagram)).toBe('edtr-code edtr-nowrap');
  });
});
