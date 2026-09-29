import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { linkPointer, type LinkHandlers } from './linkPointer';

/** Markdown nodes Code view styles as links — pictures included, so they get an honest hint too. */
const MARKDOWN_LINKS = new Set(['Link', 'Image', 'Autolink']);

/** The `href` of an `<a …>` opening tag, or null for any other tag. */
function anchorHref(state: EditorState, tag: SyntaxNode): string | null {
  const name = tag.getChild('TagName');
  if (!name || state.sliceDoc(name.from, name.to).toLowerCase() !== 'a') return null;
  for (const attr of tag.getChildren('Attribute')) {
    const attrName = attr.getChild('AttributeName');
    if (!attrName || state.sliceDoc(attrName.from, attrName.to).toLowerCase() !== 'href') continue;
    const value = attr.getChild('AttributeValue') ?? attr.getChild('UnquotedAttributeValue');
    if (!value) return '';
    return state.sliceDoc(value.from, value.to).replace(/^(["'])([\s\S]*)\1$/, '$2');
  }
  return null;
}

/**
 * The address of the link covering the character that starts at `pos` in Code
 * view's raw text, or null.
 *
 * Markdown: anywhere on `[text](address)`, `![alt](address)` or
 * `<address>` — the whole span Code view underlines. HTML: anywhere in an
 * `<a …>` opening tag, since HTML attribute values are not styled as links
 * and the tag is the one place the address is visible. A bare address typed
 * as plain text is not a link to the parser, so it is not one here either.
 */
export function linkAtPos(state: EditorState, pos: number): string | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (MARKDOWN_LINKS.has(node.name)) {
      const url = node.getChild('URL');
      return url ? state.sliceDoc(url.from, url.to) : null;
    }
    if (node.name === 'OpenTag' || node.name === 'SelfClosingTag') return anchorHref(state, node);
  }
  return null;
}

/**
 * `posAtCoords` answers with the nearest gap between characters, so over the
 * right half of a character it names the gap AFTER it. Compare against that
 * gap's screen position to recover the character actually under the pointer —
 * otherwise the last character of a link reads as outside it, and the first
 * character after `<a …>` reads as inside the tag.
 */
function linkAtEvent(view: EditorView, event: MouseEvent): string | null {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return null;
  const gap = view.coordsAtPos(pos, 1);
  const char = gap && pos > 0 && event.clientX < gap.left ? pos - 1 : pos;
  return linkAtPos(view.state, char);
}

/**
 * Code view's twin of `linkClickPlugin`: ⌘-click on a link opens it, and the
 * event is claimed so CodeMirror does not also add a cursor there. A ⌘-click
 * anywhere else is left alone and still adds a cursor.
 */
export function codeLinkExtension(getHandlers: () => LinkHandlers | undefined): Extension {
  return ViewPlugin.define(
    (view) => {
      const pointer = linkPointer(getHandlers, () => view.dom.parentElement);
      return { pointer, destroy: () => pointer.destroy() };
    },
    {
      eventHandlers: {
        mousedown(event, view) {
          if (!event.metaKey || event.button !== 0) return false;
          const href = linkAtEvent(view, event);
          if (href === null) return false;
          event.preventDefault();
          this.pointer.open(href);
          return true;
        },
        mousemove(event, view) {
          this.pointer.move(linkAtEvent(view, event), event.metaKey);
          return false;
        },
        mouseleave() {
          this.pointer.leave();
          return false;
        },
      },
    },
  );
}
