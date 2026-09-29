import { useEffect, useMemo, useState } from 'react';
import { pathExists } from '../files/fileIo';
import { classifyLink } from './linkTarget';
import { describeLink, type LinkHintText } from './linkHint';

export interface LinkHint extends LinkHintText {
  url: string;
}

/**
 * The status-bar hint for the hovered link, or undefined when none is hovered.
 *
 * A file link is checked on disk while hovered, so a link to a missing file
 * says so before anyone clicks it. Until that answer arrives the hint reads as
 * openable; an answer for a link no longer hovered is discarded.
 */
export function useLinkHint(href: string | null, docPath: string | null): LinkHint | undefined {
  const target = useMemo(() => (href === null ? null : classifyLink(href, docPath)), [href, docPath]);
  const [checked, setChecked] = useState<{ path: string; exists: boolean } | null>(null);

  useEffect(() => {
    if (target?.kind !== 'file') return;
    let current = true;
    pathExists(target.path)
      .then((exists) => { if (current) setChecked({ path: target.path, exists }); })
      .catch(() => { /* unknown stays optimistic; a click still reports a failure */ });
    return () => { current = false; };
  }, [target]);

  if (href === null || target === null) return undefined;
  const exists = target.kind === 'file' && checked?.path === target.path ? checked.exists : undefined;
  return { url: href, ...describeLink(target, exists) };
}
