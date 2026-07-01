import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';
import { goToNextCell } from './markdownTableCommands';

function setup(src: string) {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return EditorState.create({ doc: r.doc, schema: liveSchema });
}
function cursorAtText(s: EditorState, needle: string): EditorState {
  let pos = -1;
  s.doc.descendants((node, p) => {
    if (pos === -1 && node.isText && node.text === needle) pos = p + 1;
  });
  if (pos === -1) throw new Error(`text not found: ${needle}`);
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));
}
function run(s: EditorState, cmd: Command): { ok: boolean; state: EditorState } {
  let next = s; const ok = cmd(s, (tr) => { next = s.apply(tr); }); return { ok, state: next };
}

// 2x2 table: header a,b ; body c,d
const SRC = '| a | b |\n| --- | --- |\n| c | d |\n';

describe('goToNextCell', () => {
  it('Tab moves forward through cells in row-major order', () => {
    let s = cursorAtText(setup(SRC), 'a');
    s = run(s, goToNextCell(1)).state; expect(s.selection.$from.parent.textContent).toBe('b');
    s = run(s, goToNextCell(1)).state; expect(s.selection.$from.parent.textContent).toBe('c');
    s = run(s, goToNextCell(1)).state; expect(s.selection.$from.parent.textContent).toBe('d');
  });

  it('Shift-Tab moves backward through cells', () => {
    let s = cursorAtText(setup(SRC), 'd');
    s = run(s, goToNextCell(-1)).state; expect(s.selection.$from.parent.textContent).toBe('c');
    s = run(s, goToNextCell(-1)).state; expect(s.selection.$from.parent.textContent).toBe('b');
  });

  it('is a no-op at the last cell (forward) and first cell (backward), consuming the key', () => {
    const last = run(cursorAtText(setup(SRC), 'd'), goToNextCell(1));
    expect(last.ok).toBe(true);
    expect(last.state.selection.$from.parent.textContent).toBe('d'); // stayed
    const first = run(cursorAtText(setup(SRC), 'a'), goToNextCell(-1));
    expect(first.ok).toBe(true);
    expect(first.state.selection.$from.parent.textContent).toBe('a'); // stayed
  });

  it('returns false when the cursor is not in a table', () => {
    const s = cursorAtText(setup('hello\n'), 'hello');
    expect(goToNextCell(1)(s)).toBe(false);
  });
});
