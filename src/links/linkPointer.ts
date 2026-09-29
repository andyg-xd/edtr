export interface LinkHandlers {
  /** ⌘-click on a link. `href` is the address as written in the document. */
  onOpen: (href: string) => void;
  /** The link under the pointer, or null once the pointer is off every link. */
  onHover: (href: string | null) => void;
  /** Whether a ⌘-click would really open `href`. Absent means yes. */
  canOpen?: (href: string) => boolean;
}

/**
 * Set on an editor's parent element while ⌘ is held over a link that will
 * open, so CSS can show a hand only then — never over one a click refuses.
 * The parent, not the editor's own element: ProseMirror and CodeMirror both
 * rewrite the class attribute of their own root, and in every view the parent
 * is an element Edtr created.
 */
export const LINKS_ARMED_CLASS = 'edtr-links-armed';

/**
 * Hover and hand-pointer state for one editor, shared by the Live views'
 * ProseMirror plugin and Code view's CodeMirror extension so the two cannot
 * drift. The editors differ only in how they find the link under the pointer.
 */
export function linkPointer(getHandlers: () => LinkHandlers | undefined, host: () => Element | null | undefined) {
  let hovered: string | null = null;
  const opens = () => {
    if (hovered === null) return false;
    const canOpen = getHandlers()?.canOpen;
    return canOpen ? canOpen(hovered) : true;
  };
  const arm = (metaKey: boolean) => host()?.classList.toggle(LINKS_ARMED_CLASS, metaKey && opens());
  const hover = (href: string | null) => {
    if (href === hovered) return;
    hovered = href;
    getHandlers()?.onHover(href);
  };

  const onKey = (e: KeyboardEvent) => arm(e.metaKey);
  // ⌘-Tab away never delivers the keyup, so losing focus disarms too.
  const onBlur = () => arm(false);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', onBlur);

  return {
    /** Pointer moved: `href` is the link now under it, or null. */
    move(href: string | null, metaKey: boolean) {
      hover(href);
      arm(metaKey);
    },
    leave() {
      hover(null);
      arm(false);
    },
    open(href: string) {
      getHandlers()?.onOpen(href);
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      arm(false);
      hover(null);
    },
  };
}
