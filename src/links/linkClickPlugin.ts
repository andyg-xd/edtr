import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Mark } from 'prosemirror-model';
import { linkPointer, type LinkHandlers } from './linkPointer';

export { LINKS_ARMED_CLASS, type LinkHandlers } from './linkPointer';

/** Markdown keeps a link's address in `href`; HTML keeps every attribute in `htmlAttrs`. */
function markHref(mark: Mark): string | null {
  const attrs = mark.attrs as { href?: unknown; htmlAttrs?: Record<string, string> };
  if (typeof attrs.href === 'string') return attrs.href;
  return attrs.htmlAttrs?.href ?? null;
}

/**
 * The address of the link under `target`, or null.
 *
 * The DOM only says WHICH link was hit. The address is read from the document
 * model, because HTML Live's render drops unsafe addresses (`javascript:`)
 * from the page it draws — reading the DOM would report such a link as having
 * no address instead of refusing it for what it is. An `<a>` inside a block
 * Edtr shows but does not model has no mark, so its rendered `href` is used.
 */
function linkAt(view: EditorView, target: EventTarget | null): string | null {
  const anchor = (target as Element | null)?.closest?.('a');
  if (!anchor || !view.dom.contains(anchor)) return null;
  try {
    const node = view.state.doc.nodeAt(view.posAtDOM(anchor, 0));
    const mark = node?.marks.find((m) => m.type.name === 'link');
    const href = mark ? markHref(mark) : null;
    if (href !== null) return href;
  } catch { /* not a position inside the document — fall back to the render */ }
  return anchor.getAttribute('href');
}

/**
 * ⌘-click follows a link; a plain click keeps placing the caret, so link text
 * stays editable. Shared unchanged by both Live views; Code view's twin is
 * `codeLinkExtension`.
 *
 * The open happens on mousedown, and that event is swallowed: by the time a
 * click event fires the browser has already moved the caret. `getHandlers` is
 * read at event time, so a view mounted once always calls the consumer's
 * latest callbacks.
 */
export function linkClickPlugin(getHandlers: () => LinkHandlers | undefined): Plugin {
  let pointer: ReturnType<typeof linkPointer> | null = null;

  return new Plugin({
    view(view) {
      pointer = linkPointer(getHandlers, () => view.dom.parentElement);
      return { destroy() { pointer?.destroy(); pointer = null; } };
    },
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (!event.metaKey || event.button !== 0) return false;
          const href = linkAt(view, event.target);
          if (href === null) return false;
          event.preventDefault();
          pointer?.open(href);
          return true;
        },
        click(view, event) {
          if (!event.metaKey || linkAt(view, event.target) === null) return false;
          event.preventDefault();
          return true;
        },
        mousemove(view, event) {
          pointer?.move(linkAt(view, event.target), event.metaKey);
          return false;
        },
        mouseleave() {
          pointer?.leave();
          return false;
        },
      },
    },
  });
}
