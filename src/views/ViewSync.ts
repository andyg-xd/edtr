import type { Node as PMNode } from 'prosemirror-model';
import { spliceSource } from '../doc/splice';
import type { SpliceEdit, FlavorProfile } from '../doc/types';
import { buildLiveDoc, type LiveResult } from './liveModel';
import { serializeBlock } from './markdownSerializer';

/** Build the read-only Live document from source (or signal degrade). */
export function toLive(source: string): LiveResult {
  return buildLiveDoc(source);
}

/**
 * Re-derive source from the Live document. `serializeBlock` returns the new
 * source text for a dirty block, or null to leave it untouched. With no
 * callback (3a, read-only) every block is untouched → the original source is
 * returned verbatim. Untouched bytes (incl. inter-block whitespace) are never
 * re-emitted — this is the no-beautify guarantee.
 */
export function toSource(
  doc: PMNode,
  originalSource: string,
  serializeBlock?: (block: PMNode) => string | null,
): string {
  if (!serializeBlock) return originalSource;
  const edits: SpliceEdit[] = [];
  doc.forEach((block) => {
    const next = serializeBlock(block);
    if (next === null) return;
    const { srcFrom, srcTo } = block.attrs as { srcFrom: number; srcTo: number };
    edits.push({ start: srcFrom, end: srcTo, text: next });
  });
  return spliceSource(originalSource, edits);
}

/**
 * A `toSource` callback: returns re-serialized Markdown for blocks in the
 * dirty set, or `null` for untouched blocks (→ emitted verbatim).
 */
export function serializeDirty(
  dirty: Set<string>,
  flavor: FlavorProfile,
): (block: PMNode) => string | null {
  return (block) => {
    const id = block.attrs.blockId as string;
    if (!dirty.has(id)) return null;
    return serializeBlock(block, flavor);
  };
}

/** Re-derive source: splice re-serialized dirty blocks into the baseline. */
export function writeBack(
  doc: PMNode,
  baseline: string,
  dirty: Set<string>,
  flavor: FlavorProfile,
): string {
  return toSource(doc, baseline, serializeDirty(dirty, flavor));
}
