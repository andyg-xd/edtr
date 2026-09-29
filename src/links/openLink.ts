import { openUrl } from '@tauri-apps/plugin-opener';
import { pathExists } from '../files/fileIo';
import { openInNewWindow } from '../files/fileController';
import { classifyLink, type LinkTarget } from './linkTarget';

type Refusal = Exclude<LinkTarget, { kind: 'web' } | { kind: 'file' }>;

function refusal(target: Refusal): string {
  if (target.kind === 'section') {
    return "Edtr can't jump to a section of a page yet. This link points to a spot in the same file.";
  }
  switch (target.reason) {
    case 'empty': return 'This link has no address.';
    case 'malformed': return "This link's address isn't written correctly, so Edtr can't open it.";
    case 'unsaved': return 'Save this file first. The link points to a file next to it, and Edtr needs to know where this one lives.';
    case 'file-type': return 'Edtr only opens links to Markdown, HTML and text files, so this one was not opened.';
    case 'scheme': return 'Edtr only opens web, email and file links, so this one was not opened.';
  }
}

/**
 * Follow a link from a document. Returns a plain-language notice when the
 * link was not opened, or `null` when it was.
 *
 * Web links go to the default browser through the opener plugin, whose own
 * permission scope admits only http, https, mailto and tel — a second guard
 * behind `classifyLink`. Linked files open in a new Edtr window, never in
 * another app.
 */
export async function openLink(href: string, docPath: string | null): Promise<string | null> {
  const target = classifyLink(href, docPath);
  try {
    if (target.kind === 'web') {
      await openUrl(target.url);
      return null;
    }
    if (target.kind === 'file') {
      if (!(await pathExists(target.path))) {
        return `Edtr couldn't find the linked file, ${target.path.slice(target.path.lastIndexOf('/') + 1)}.`;
      }
      await openInNewWindow({ kind: 'files', paths: [target.path] });
      return null;
    }
  } catch (e) {
    return `Edtr couldn't open that link. ${String(e)}`;
  }
  return refusal(target);
}
