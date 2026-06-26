import { describe, it, expect } from 'vitest';
import { detectFlavor } from './flavor';

describe('detectFlavor (markdown)', () => {
  it('detects the bullet marker actually used', () => {
    expect(detectFlavor('* one\n* two\n', 'markdown').bullet).toBe('*');
    expect(detectFlavor('- one\n- two\n', 'markdown').bullet).toBe('-');
    expect(detectFlavor('+ one\n', 'markdown').bullet).toBe('+');
  });

  it('detects emphasis marker', () => {
    expect(detectFlavor('this is _em_ text', 'markdown').emphasis).toBe('_');
    expect(detectFlavor('this is *em* text', 'markdown').emphasis).toBe('*');
  });

  it('detects strong marker', () => {
    expect(detectFlavor('__bold__', 'markdown').strong).toBe('__');
    expect(detectFlavor('**bold**', 'markdown').strong).toBe('**');
  });

  it('flags gfm when tables are present', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |\n';
    expect(detectFlavor(table, 'markdown').gfm).toBe(true);
    expect(detectFlavor('plain paragraph', 'markdown').gfm).toBe(false);
  });

  it('falls back to documented defaults when markers are absent', () => {
    const f = detectFlavor('plain paragraph, no markers', 'markdown');
    expect(f.bullet).toBe('-');
    expect(f.emphasis).toBe('*');
    expect(f.strong).toBe('**');
    expect(f.headingStyle).toBe('atx');
    expect(f.fence).toBe('`');
    expect(f.orderedDelimiter).toBe('.');
  });
});
