import { describe, it, expect } from 'vitest';
import { liveSchema } from '../views/liveSchema';
import { htmlSchema } from '../views/htmlSchema';
import { flattenBlocks } from './flattenBlocks';
import { mapStart } from './types';

const s = liveSchema;
const p = (...content: unknown[]) => s.node('paragraph', null, content as never);
const t = (text: string) => s.text(text);

describe('flattenBlocks', () => {
  it('produces one segment per top-level block', () => {
    const doc = s.node('doc', null, [p(t('first')), p(t('second'))]);
    expect(flattenBlocks(doc).map((x) => x.text)).toEqual(['first', 'second']);
  });

  it('joins text across a formatting boundary within a block', () => {
    // "he" + bold "ll" + "o" is one word to the user, so it is one string to
    // the matcher. This is what lets a match cross formatting (design §5.3).
    const doc = s.node('doc', null, [
      p(t('he'), s.text('ll', [s.mark('strong')]), t('o')),
    ]);
    expect(flattenBlocks(doc)[0].text).toBe('hello');
  });

  it('maps an offset back to the right document position', () => {
    const doc = s.node('doc', null, [p(t('abc')), p(t('def'))]);
    const segs = flattenBlocks(doc);
    // Block 1 starts at 0, its content at 1 → 'a' is position 1.
    expect(mapStart(segs[0].map, 0)).toBe(1);
    // Block 1 occupies 0..5 ("abc" + open + close), so block 2's content
    // starts at 6 → 'd' is position 6.
    expect(mapStart(segs[1].map, 0)).toBe(6);
  });

  it('round-trips every offset in a multi-run block', () => {
    const doc = s.node('doc', null, [p(t('ab'), s.text('cd', [s.mark('em')]))]);
    const [seg] = flattenBlocks(doc);
    expect(seg.text).toBe('abcd');
    expect([0, 1, 2, 3].map((o) => mapStart(seg.map, o))).toEqual([1, 2, 3, 4]);
  });

  it('gives a hard break a newline, so a block CAN contain one', () => {
    const doc = s.node('doc', null, [p(t('a'), s.node('hardBreak'), t('b'))]);
    expect(flattenBlocks(doc)[0].text).toBe('a\nb');
  });

  it('contributes no text for an image, and lets a match span it', () => {
    const doc = s.node('doc', null, [
      p(t('ca'), s.node('image', { src: 'x.png' }), t('t')),
    ]);
    const [seg] = flattenBlocks(doc);
    expect(seg.text).toBe('cat');
    // The image occupies a position, so 't' is NOT at the position that
    // simple string arithmetic would predict. That is the whole point of the map.
    expect(mapStart(seg.map, 2)).toBe(4);
  });

  it('contributes no text for a verbatim block', () => {
    const doc = s.node('doc', null, [
      s.node('verbatim', { raw: 'secret' }),
      p(t('visible')),
    ]);
    expect(flattenBlocks(doc).map((x) => x.text)).toEqual(['', 'visible']);
  });

  it('descends into nested structures', () => {
    const doc = s.node('doc', null, [
      s.node('bulletList', null, [
        s.node('listItem', null, [p(t('one'))]),
        s.node('listItem', null, [p(t('two'))]),
      ]),
    ]);
    // A list is ONE top-level block, so its items share one segment.
    expect(flattenBlocks(doc)[0].text).toBe('onetwo');
  });

  it('runs table cells together — a table is one block', () => {
    const cell = (text: string) => s.node('tableCell', null, [s.text(text)]);
    const doc = s.node('doc', null, [
      s.node('table', null, [s.node('tableRow', null, [cell('a'), cell('b')])]),
    ]);
    expect(flattenBlocks(doc)[0].text).toBe('ab');
  });

  it('works on the HTML schema too, skipping inline verbatim', () => {
    const h = htmlSchema;
    const doc = h.node('doc', null, [
      h.node('paragraph', null, [
        h.text('vis'),
        h.node('inlineVerbatim', { raw: '<script>x</script>' }),
        h.text('ible'),
      ]),
    ]);
    expect(flattenBlocks(doc)[0].text).toBe('visible');
  });
});
