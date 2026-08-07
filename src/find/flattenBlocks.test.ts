import { describe, it, expect } from 'vitest';
import { liveSchema } from '../views/liveSchema';
import { htmlSchema } from '../views/htmlSchema';
import { flattenBlocks } from './flattenBlocks';
import { mapStart } from './types';
import { matchSegments } from './matchText';
import { emptyQuery } from './findQuery';

const s = liveSchema;
const p = (...content: unknown[]) => s.node('paragraph', null, content as never);
const t = (text: string) => s.text(text);

describe('flattenBlocks', () => {
  it('produces one segment per visible block', () => {
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

  it('contributes no segment at all for a skipped atom', () => {
    // A verbatim block is an atom with no inner positions — it doesn't even
    // contribute an EMPTY segment, unlike a real (empty) textblock would.
    const doc = s.node('doc', null, [
      s.node('verbatim', { raw: 'secret' }),
      p(t('visible')),
    ]);
    expect(flattenBlocks(doc).map((x) => x.text)).toEqual(['visible']);
  });

  it('descends into nested structures, one segment per list item', () => {
    const doc = s.node('doc', null, [
      s.node('bulletList', null, [
        s.node('listItem', null, [p(t('one'))]),
        s.node('listItem', null, [p(t('two'))]),
      ]),
    ]);
    // A list is a CONTAINER, not a visible block itself — its two paragraphs
    // are the visible blocks, so they get separate segments.
    expect(flattenBlocks(doc).map((x) => x.text)).toEqual(['one', 'two']);
  });

  it('gives each table cell its own segment, not the whole table', () => {
    const cell = (text: string) => s.node('tableCell', null, [s.text(text)]);
    const doc = s.node('doc', null, [
      s.node('table', null, [s.node('tableRow', null, [cell('a'), cell('b')])]),
    ]);
    expect(flattenBlocks(doc).map((x) => x.text)).toEqual(['a', 'b']);
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

  // The three tests below pin the bug this fix corrects: before it, a
  // container's descendants shared ONE segment with no separator, so a match
  // could silently span two blocks the user sees as separate, and a
  // whole-word search could miss a word that is visible twice.

  it('gives a section three segments, so whole-word search finds a word repeated across its paragraphs', () => {
    const h = htmlSchema;
    const section = h.node('container', { tag: 'section' }, [
      h.node('heading', { level: 1 }, [h.text('Release notes')]),
      h.node('paragraph', null, [h.text('Fixed the export bug')]),
      h.node('paragraph', null, [h.text('Bug reports welcome')]),
    ]);
    const doc = h.node('doc', null, [section]);
    const segments = flattenBlocks(doc);
    expect(segments.map((x) => x.text)).toEqual([
      'Release notes',
      'Fixed the export bug',
      'Bug reports welcome',
    ]);
    const run = matchSegments(
      segments,
      { ...emptyQuery, text: 'bug', wholeWord: true },
      { multiline: false },
    );
    expect(run.matches.length).toBe(2);
  });

  it('finds a whole word that only the OLD flattening would have glued to its neighbour', () => {
    const doc = s.node('doc', null, [
      s.node('bulletList', null, [
        s.node('listItem', null, [p(t('buy milk'))]),
        s.node('listItem', null, [p(t('need eggs'))]),
      ]),
    ]);
    // Concatenated with no separator this would be "buy milkneed eggs" —
    // "milk" immediately followed by a word character, so `\bmilk\b` would
    // find nothing. Segmented per item, it is unambiguous.
    const run = matchSegments(
      flattenBlocks(doc),
      { ...emptyQuery, text: 'milk', wholeWord: true },
      { multiline: false },
    );
    expect(run.matches.length).toBe(1);
  });

  it('never lets a match span two visible blocks', () => {
    // The two paragraphs are nested inside a blockquote -- a CONTAINER -- on
    // purpose: two top-level paragraphs were already separate segments even
    // under the old per-top-level-node walk, so that shape can't tell the old
    // behaviour from the new one. Nested one level deep, the old walk would
    // treat the blockquote as the one top-level segment and glue its two
    // paragraphs together with no separator -- "caterpillar" would be sitting
    // right there, matchable. Segmented per visible block, it cannot be found.
    const doc = s.node('doc', null, [
      s.node('blockquote', null, [p(t('cat')), p(t('erpillar'))]),
    ]);
    const run = matchSegments(
      flattenBlocks(doc),
      { ...emptyQuery, text: 'caterpillar' },
      { multiline: false },
    );
    expect(run.matches).toEqual([]);
  });
});
