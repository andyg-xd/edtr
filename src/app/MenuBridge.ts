import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface BridgeHandlers {
  onOpen: () => void;
  onSave: () => void;
  onCloseRequest: () => void;
}

/**
 * Binds ⌘O / ⌘S and intercepts the window close button. Handlers are read
 * through a ref so the listeners always call the latest closures without
 * re-subscribing on every render.
 */
export function useShortcutsAndCloseGuard(handlers: BridgeHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        ref.current.onSave();
      } else if (key === 'o') {
        e.preventDefault();
        ref.current.onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested((event) => {
        // Always intercept; EditorWindow decides whether to prompt or destroy.
        event.preventDefault();
        ref.current.onCloseRequest();
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);
}
