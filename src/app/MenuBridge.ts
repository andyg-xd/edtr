import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { dispatchMenuCommand, type MenuCommand, type MenuHandlers } from './menuCommands';

/**
 * Bridges the native menu (src-tauri) and the window close button to app
 * handlers. The native menu owns the ⌘O/⌘S/⌘W/⌘Q accelerators and emits
 * `menu://*` events; we listen and dispatch. The red traffic-light button does
 * NOT go through the menu, so we still intercept `onCloseRequested`. Handlers
 * are read through a ref so listeners always call the latest closures without
 * re-subscribing on every render.
 */
export function useMenuAndCloseGuard(handlers: MenuHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  // Native-menu events → handlers.
  useEffect(() => {
    const commands: MenuCommand[] = ['open', 'open-folder', 'save', 'close'];
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const win = getCurrentWebviewWindow();
    for (const cmd of commands) {
      win.listen(`menu://${cmd}`, () => dispatchMenuCommand(cmd, ref.current))
        .then((un) => { if (disposed) un(); else unlisteners.push(un); })
        .catch(() => {});
    }
    return () => { disposed = true; unlisteners.forEach((un) => un()); };
  }, []);

  // Window close button (⌘W is handled by the File → Close menu item; this
  // covers the red traffic-light button) → guard via onCloseRequest.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested((event) => {
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
