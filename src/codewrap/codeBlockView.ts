import type { Node as PMNode } from 'prosemirror-model';
import type { Decoration, NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';
import { toggleCodeWrapAt } from './codeWrapPlugin';
import { isTextDiagram } from './textDiagram';

function wrapFrom(decorations: readonly Decoration[], node: PMNode): boolean {
  const deco = decorations.find((d) => typeof (d.spec as { wrap?: unknown }).wrap === 'boolean');
  return deco ? (deco.spec as { wrap: boolean }).wrap : !isTextDiagram(node.textContent);
}

/**
 * Markdown Live's code block: `div.edtr-code > button.code-wrap-toggle + pre > code`.
 *
 * The label sits on the wrapper rather than inside the `pre`, so an unwrapped
 * block's sideways scroll cannot clip it. The wrapper also receives every node
 * decoration's classes — `codeWrapPlugin`'s and focus mode's alike.
 */
export const codeBlockView: NodeViewConstructor = (initial, view, getPos, decorations) => {
  let node = initial;

  const dom = document.createElement('div');
  dom.className = 'edtr-code';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'code-wrap-toggle';
  button.setAttribute('contenteditable', 'false');
  // The caret stays where it was; a press on the label is not a click in the text.
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', () => {
    const pos = getPos();
    if (pos !== undefined) toggleCodeWrapAt(pos)(view.state, view.dispatch);
  });

  const pre = document.createElement('pre');
  if (node.attrs.lang) pre.setAttribute('data-lang', node.attrs.lang as string);
  const code = document.createElement('code');
  pre.appendChild(code);
  dom.append(button, pre);

  const label = (decos: readonly Decoration[]) => {
    const wrap = wrapFrom(decos, node);
    button.textContent = wrap ? 'Wrap' : 'No wrap';
  };
  label(decorations);

  const inButton = (target: EventTarget | Node | null) => target instanceof Node && button.contains(target);

  const nodeView: NodeView = {
    dom,
    contentDOM: code,
    update(next, decos) {
      if (next.type !== node.type || next.attrs.lang !== node.attrs.lang) return false;
      node = next;
      label(decos);
      return true;
    },
    stopEvent: (event) => inButton(event.target),
    ignoreMutation: (mutation: ViewMutationRecord) => inButton(mutation.target),
  };
  return nodeView;
};
