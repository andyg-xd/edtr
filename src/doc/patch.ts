import { spliceSource } from './splice';
import type { SourceDocument } from './document';
import type { Patch, SpliceEdit } from './types';

/** Resolve node-relative patches to splice edits and apply them surgically. */
export function applyPatches(doc: SourceDocument, patches: Patch[]): string {
  const edits: SpliceEdit[] = patches.map((p) => toSpliceEdit(doc, p));
  return spliceSource(doc.source, edits);
}

function toSpliceEdit(doc: SourceDocument, patch: Patch): SpliceEdit {
  const node = doc.findNode(patch.nodeId);
  if (!node) throw new Error(`Unknown node id: ${patch.nodeId}`);
  const [start, end] = node.range;

  // Refuse to patch a node with no reliable source location: a zero-width
  // range means the parser could not locate it (synthetic/position-less node).
  // Splicing it would write at the wrong offset and corrupt the file.
  if (start === end) {
    throw new Error(
      `Cannot patch node ${patch.nodeId}: zero-width range (no reliable source location)`,
    );
  }

  switch (patch.kind) {
    case 'replace':
      return { start, end, text: patch.text };
    case 'delete':
      return { start, end, text: '' };
    case 'insertAfter':
      return { start: end, end, text: patch.text };
    case 'insertBefore':
      return { start, end: start, text: patch.text };
  }
}
