import type { LinkTarget } from './linkTarget';

/** What the status bar says about a hovered link. */
export interface LinkHintText {
  action: string;
  /** Whether a ⌘-click will actually open it — only then is the hint an invitation. */
  openable: boolean;
}

export function isOpenable(target: LinkTarget): boolean {
  return target.kind === 'web' || target.kind === 'file';
}

/**
 * Status-bar wording for a hovered link. Derived from the same classification
 * a ⌘-click acts on, so the hint cannot promise what the click will refuse.
 * `fileExists` is the answer to an on-disk check for a file link, when known.
 */
export function describeLink(target: LinkTarget, fileExists?: boolean): LinkHintText {
  if (target.kind === 'web') return { action: '⌘-click to open', openable: true };
  if (target.kind === 'file') {
    return fileExists === false
      ? { action: 'File not found', openable: false }
      : { action: '⌘-click to open in Edtr', openable: true };
  }
  if (target.kind === 'section') return { action: "Edtr can't jump to sections yet", openable: false };
  switch (target.reason) {
    case 'file-type': return { action: "Edtr can't open this kind of file", openable: false };
    case 'scheme': return { action: "Edtr doesn't open this kind of link", openable: false };
    case 'unsaved': return { action: 'Save this file to follow this link', openable: false };
    case 'empty': return { action: 'This link has no address', openable: false };
    case 'malformed': return { action: "This link's address isn't valid", openable: false };
  }
}
