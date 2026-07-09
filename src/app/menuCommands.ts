/** The native-menu commands the Rust side emits as `menu://<command>` events. */
export type MenuCommand = 'open' | 'open-folder' | 'save' | 'close';

/** App-level handlers the menu (and window close button) drive. */
export interface MenuHandlers {
  onOpen: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onCloseRequest: () => void;
}

/**
 * Route a native-menu command to its handler. The single source of the
 * command↔handler contract, so a wrong/typo'd command fails a test rather than
 * silently no-op'ing at runtime.
 */
export function dispatchMenuCommand(command: MenuCommand, handlers: MenuHandlers): void {
  switch (command) {
    case 'open': handlers.onOpen(); break;
    case 'open-folder': handlers.onOpenFolder(); break;
    case 'save': handlers.onSave(); break;
    case 'close': handlers.onCloseRequest(); break;
  }
}
