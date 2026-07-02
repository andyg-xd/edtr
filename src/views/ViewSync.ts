import type { Node as PMNode } from 'prosemirror-model';
import { spliceSource } from '../doc/splice';
import type { SpliceEdit, FlavorProfile } from '../doc/types';
import { buildLiveDoc, type LiveResult } from './liveModel';
import { serializeBlock } from './markdownSerializer';

/** Build the read-only Live document from source (or signal degrade). */
export function toLive(source: string, docPath: string | null = null): LiveResult {
  return buildLiveDoc(source, docPath);
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

type BaselineRef = { id: string; from: number; to: number; index: number };

/**
 * Re-derive source from the current Live doc by RECONSTRUCTION (not per-block
 * splice), so split/merge/insert are handled while untouched blocks + untouched
 * inter-block gaps stay byte-identical. A block is "new" iff its id is not in
 * the baseline. `baselineDoc` (the doc built when Live was entered) supplies the
 * baseline block ranges/order; when omitted, the baseline string is re-parsed
 * (deterministic ids → matches). This strictly generalizes the count-stable
 * splice model: the no-op case reconstructs the baseline byte-for-byte.
 */
export function writeBack(
  doc: PMNode,
  baseline: string,
  dirty: Set<string>,
  flavor: FlavorProfile,
  baselineDoc?: PMNode,
): string {
  let base = baselineDoc;
  if (!base) {
    const r = buildLiveDoc(baseline);
    if (!r.ok) throw new Error(`writeBack: baseline no longer parses (${r.reason})`);
    base = r.doc;
  }

  const refs: BaselineRef[] = [];
  base.forEach((b, _off, index) => {
    refs.push({
      id: b.attrs.blockId as string,
      from: b.attrs.srcFrom as number,
      to: b.attrs.srcTo as number,
      index,
    });
  });
  const byId = new Map<string, BaselineRef>();
  for (const r of refs) byId.set(r.id, r);

  // Doc-leading whitespace + trailing newline (empty baseline → whole string is prefix).
  const prefix = refs.length ? baseline.slice(0, refs[0].from) : baseline;
  const suffix = refs.length ? baseline.slice(refs[refs.length - 1].to) : '';

  const parts: string[] = [];
  let prev: BaselineRef | null = null; // previous emitted block's baseline ref (null if it was new)
  let first = true;
  doc.forEach((block) => {
    const id = block.attrs.blockId as string;
    const ref = byId.get(id) ?? null;
    const isDirty = dirty.has(id);
    const text = ref && !isDirty ? baseline.slice(ref.from, ref.to) : serializeBlock(block, flavor);
    if (!first) {
      if (prev && ref && ref.index === prev.index + 1) {
        parts.push(baseline.slice(prev.to, ref.from)); // reuse exact baseline gap (no beautify)
      } else {
        parts.push('\n\n'); // adjacency changed → synthesized separator
      }
    }
    parts.push(text);
    prev = ref;
    first = false;
  });

  return prefix + parts.join('') + suffix;
}
