import type { OpenPayload } from '../files/openPayload';

/**
 * Every native-menu command, and the ONLY list of them. `MenuBridge`
 * subscribes from this array and `MenuCommand` is derived from it, so a
 * command can never exist in the type but be missing a listener — which is
 * exactly how ⌥⌘F shipped firing an event nobody heard.
 */
export const MENU_COMMANDS = [
  'open', 'open-folder', 'save', 'save-as', 'close',
  'quit-poll', 'quit-abort',
  'find', 'find-next', 'find-prev', 'replace',
] as const;

/** The native-menu commands the Rust side emits as `menu://<command>` events. */
export type MenuCommand = typeof MENU_COMMANDS[number];

/** App-level handlers the menu (and window close button) drive. */
export interface MenuHandlers {
  onOpen: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseRequest: () => void;
  /** ⌘Q started an atomic-quit poll — this window must vote (5b-iii-b). */
  onQuitPoll: () => void;
  /** The quit poll was aborted — dismiss any open quit prompt (5b-iii-b). */
  onQuitAbort: () => void;
  /** An OS/warm open delivered a payload to this (focused) window. */
  onOpenPayload: (payload: OpenPayload) => void;
  /** ⌘F — open the find bar (or refocus it if it is already open). */
  onFind: () => void;
  /** ⌘G — go to the next match. */
  onFindNext: () => void;
  /** ⇧⌘G — go to the previous match. */
  onFindPrev: () => void;
  /** ⌥⌘F — open the find bar with the replace row. */
  onReplace: () => void;
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
    case 'save-as': handlers.onSaveAs(); break;
    case 'close': handlers.onCloseRequest(); break;
    case 'quit-poll': handlers.onQuitPoll(); break;
    case 'quit-abort': handlers.onQuitAbort(); break;
    case 'find': handlers.onFind(); break;
    case 'find-next': handlers.onFindNext(); break;
    case 'find-prev': handlers.onFindPrev(); break;
    case 'replace': handlers.onReplace(); break;
  }
}
