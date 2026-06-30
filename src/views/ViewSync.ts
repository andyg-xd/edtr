import type { Node as PMNode } from 'prosemirror-model';
import { spliceSource } from '../doc/splice';
import type { SpliceEdit } from '../doc/types';
import { buildLiveDoc, type LiveResult } from './liveModel';

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
