import { describe, it, expect } from 'vitest';
import { classifyLink } from './linkTarget';
import { describeLink, isOpenable } from './linkHint';

const DOC = '/Users/me/docs/plan.md';
const hint = (href: string, exists?: boolean) => describeLink(classifyLink(href, DOC), exists);

describe('describeLink', () => {
  it('invites a ⌘-click only for links that will open', () => {
    expect(hint('https://example.com')).toEqual({ action: '⌘-click to open', openable: true });
    expect(hint('mailto:a@example.com')).toEqual({ action: '⌘-click to open', openable: true });
    expect(hint('./notes.md')).toEqual({ action: '⌘-click to open in Edtr', openable: true });
  });

  it('says a linked file is missing once that is known', () => {
    expect(hint('./notes.md', true)).toEqual({ action: '⌘-click to open in Edtr', openable: true });
    expect(hint('./gone.md', false)).toEqual({ action: 'File not found', openable: false });
  });

  it('says plainly why every other link will not open', () => {
    expect(hint('#features')).toEqual({ action: "Edtr can't jump to sections yet", openable: false });
    expect(hint('photo.png')).toEqual({ action: "Edtr can't open this kind of file", openable: false });
    expect(hint('javascript:alert(1)')).toEqual({ action: "Edtr doesn't open this kind of link", openable: false });
    expect(describeLink(classifyLink('notes.md', null))).toEqual({ action: 'Save this file to follow this link', openable: false });
    expect(hint('')).toEqual({ action: 'This link has no address', openable: false });
    expect(hint('bad%E0%A4%A.md')).toEqual({ action: "This link's address isn't valid", openable: false });
  });
});

describe('isOpenable', () => {
  it('is true for web and file links and false for everything else', () => {
    expect(isOpenable(classifyLink('https://example.com', DOC))).toBe(true);
    expect(isOpenable(classifyLink('./notes.md', DOC))).toBe(true);
    expect(isOpenable(classifyLink('#top', DOC))).toBe(false);
    expect(isOpenable(classifyLink('run.command', DOC))).toBe(false);
  });
});
