/** What the Edit menu's Undo / Redo needs from the open document. */
export interface HistoryTarget {
  historyStep: (direction: 'undo' | 'redo') => void;
}

/** Inside one of the editors: CodeMirror, either Live view, or HTML Live's host. */
function inEditor(el: Element): boolean {
  return !!el.closest('.cm-editor, .ProseMirror, .html-live-view');
}

function isTextField(el: Element | null): boolean {
  if (!el || inEditor(el)) return false;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    || (el instanceof HTMLElement && el.isContentEditable);
}

/**
 * Edit → Undo / Redo, and ⌘Z / ⇧⌘Z whenever no editor handled the key itself.
 *
 * These were the system's own menu items, which run WebKit's undo stack. That
 * stack fills only from native typing and both editors cancel it in favour of
 * their own, so from the menu Undo often did nothing and Redo never could.
 * Now: a text field outside the editors (find, replace) keeps the system
 * behaviour; everything else steps the document.
 */
export function runMenuHistory(
  direction: 'undo' | 'redo',
  doc: HistoryTarget | null,
  exec: (command: string) => boolean = (c) => document.execCommand(c),
): void {
  if (!doc || isTextField(document.activeElement)) {
    exec(direction);
    return;
  }
  doc.historyStep(direction);
}
