// @vitest-environment jsdom
import { describe, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { htmlSchema } from '../views/htmlSchema';
import { textblockRanges } from './pmFocus';
import { activeBlock } from './activeBlock';

describe('PROBE: does the focus dim reach a table cell?', () => {
  it('reports what the pieces actually do', () => {
    const h = htmlSchema;
    const cell = (text: string) =>
      h.node('tableCell', {}, [h.node('paragraph', {}, [h.text(text)])]);
    const doc = h.node('doc', null, [
      h.node('paragraph', { blockId: 'b0', srcFrom: 0, srcTo: 10 }, [h.text('before')]),
      h.node('table', { blockId: 'b1', srcFrom: 10, srcTo: 90 }, [
        h.node('tableRow', {}, [cell('A1'), cell('B1')]),
        h.node('tableRow', {}, [cell('A2'), cell('B2')]),
      ]),
      h.node('paragraph', { blockId: 'b2', srcFrom: 90, srcTo: 99 }, [h.text('after')]),
    ]);

    const ranges = textblockRanges(doc);
    console.log('RANGES =', JSON.stringify(ranges));

    let caret = -1;
    doc.descendants((node, pos) => {
      if (caret === -1 && node.isTextblock && node.textContent === 'A1') caret = pos + 1;
      return caret === -1;
    });
    console.log('CARET (inside cell A1) =', caret);

    const state = EditorState.create({ doc });
    const withCaret = state.apply(state.tr.setSelection(TextSelection.create(doc, caret)));
    console.log('HEAD =', withCaret.selection.head);
    console.log('ACTIVE =', JSON.stringify(activeBlock(ranges, withCaret.selection.head)));

    // What the plugin would dim: every textblock whose start !== active.from.
    const active = activeBlock(ranges, withCaret.selection.head);
    const dimmed: string[] = [];
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      if (active && pos + 1 === active.from) return false;
      dimmed.push(node.textContent);
      return false;
    });
    console.log('WOULD DIM =', JSON.stringify(dimmed));
  });
});
