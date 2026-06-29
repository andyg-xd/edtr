import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface WindowChromeProps {
  name: string | null;
  dirty: boolean;
}

/** Top bar: filename + dirty dot. Also keeps the OS window title in sync. */
export function WindowChrome({ name, dirty }: WindowChromeProps) {
  useEffect(() => {
    const title = name ? `${dirty ? '• ' : ''}${name} — Edtr` : 'Edtr';
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [name, dirty]);

  return (
    <header className="window-chrome">
      <span className="doc-name">{name ?? 'No file open'}</span>
      {dirty && (
        <span className="dirty-dot" aria-label="Unsaved changes" title="Unsaved changes">
          {'●'}
        </span>
      )}
    </header>
  );
}
