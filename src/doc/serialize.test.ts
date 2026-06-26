import { describe, it, expect } from 'vitest';
import { serializeNode } from './serialize';
import type { FlavorProfile } from './types';

const star: FlavorProfile = {
  bullet: '*', emphasis: '*', strong: '**', headingStyle: 'atx', fence: '`', orderedDelimiter: '.', gfm: false,
};
const underscore: FlavorProfile = { ...star, emphasis: '_', strong: '__' };

describe('serializeNode', () => {
  it('serializes a paragraph as its text', () => {
    expect(serializeNode({ type: 'paragraph', text: 'Hello world' }, star)).toBe('Hello world');
  });

  it('serializes an ATX heading at the given depth', () => {
    expect(serializeNode({ type: 'heading', depth: 2, text: 'Title' }, star)).toBe('## Title');
  });

  it('serializes a setext heading when the flavor calls for it', () => {
    const setext: FlavorProfile = { ...star, headingStyle: 'setext' };
    expect(serializeNode({ type: 'heading', depth: 1, text: 'Title' }, setext)).toBe('Title\n=====');
    expect(serializeNode({ type: 'heading', depth: 2, text: 'Sub' }, setext)).toBe('Sub\n---');
  });

  it('honors the strong marker from the flavor', () => {
    expect(serializeNode({ type: 'strong', text: 'bold' }, star)).toBe('**bold**');
    expect(serializeNode({ type: 'strong', text: 'bold' }, underscore)).toBe('__bold__');
  });

  it('honors the emphasis marker from the flavor', () => {
    expect(serializeNode({ type: 'emphasis', text: 'em' }, star)).toBe('*em*');
    expect(serializeNode({ type: 'emphasis', text: 'em' }, underscore)).toBe('_em_');
  });
});
