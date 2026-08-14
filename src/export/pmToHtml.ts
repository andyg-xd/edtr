import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { liveSchema } from '../views/liveSchema';

/**
 * A Markdown document, rendered to an HTML body fragment (6c-iii, D3).
 *
 * Serializes the DOCUMENT through the schema's own `toDOM`, rather than
 * scraping the live editor's DOM. That is what makes this ONE definition of
 * how Markdown renders, shared with the editor — and it is also why no
 * artifact-stripping is needed: `contenteditable`, `ProseMirror*` classes and
 * decoration wrappers are added by `EditorView`, never by `toDOM`, so they
 * cannot appear here.
 *
 * Images are the one exception. `liveSchema.ts:121-124` renders
 * `displaySrc ?? src`, and `displaySrc` is an asset-protocol URL that means
 * nothing outside this app — so the document is rebuilt with `displaySrc`
 * cleared before serializing, which puts the real relative path back.
 */
export function pmToHtml(doc: PMNode): string {
  const serializer = DOMSerializer.fromSchema(liveSchema);
  const fragment = serializer.serializeFragment(withRealImageSrcs(doc).content, { document });
  const host = document.createElement('div');
  host.appendChild(fragment);
  return host.innerHTML;
}

/** A copy of `doc` with every `displaySrc` cleared, so `toDOM` emits `src`. */
function withRealImageSrcs(doc: PMNode): PMNode {
  const children: PMNode[] = [];
  doc.forEach((node) => { children.push(stripDisplaySrc(node)); });
  return liveSchema.node('doc', doc.attrs, children);
}

function stripDisplaySrc(node: PMNode): PMNode {
  if (node.isText) return node;
  const children: PMNode[] = [];
  node.forEach((child) => { children.push(stripDisplaySrc(child)); });
  const attrs = node.attrs?.displaySrc != null
    ? { ...node.attrs, displaySrc: null }
    : node.attrs;
  return node.type.create(attrs, children.length ? children : null, node.marks);
}
