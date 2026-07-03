import type { Node as PMNode } from 'prosemirror-model';
import { spliceSource } from '../doc/splice';
import type { SpliceEdit, FlavorProfile } from '../doc/types';
import { buildLiveDoc, type LiveResult } from './liveModel';
import { serializeBlock } from './markdownSerializer';
import { serializeHtmlBlock } from './htmlSerializer';
import { toLiveHtml } from './htmlModel';

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

type ReconcileOpts = {
  serialize: (block: PMNode) => string;
  separator: string;
  buildBaseline: () => PMNode;
};

/**
 * Format-agnostic reconstruction reconciler. Walks the current doc's top-level
 * blocks: an untouched baseline block (id present, not dirty) emits its exact
 * baseline byte-slice; otherwise it is re-serialized. Between two blocks that
 * were adjacent in the baseline, the exact baseline gap is reused; otherwise
 * `opts.separator` is synthesized. No-op ⇒ baseline reproduced byte-for-byte.
 */
function reconcile(
  doc: PMNode,
  baseline: string,
  dirty: Set<string>,
  opts: ReconcileOpts,
  baselineDoc?: PMNode,
): string {
  const base = baselineDoc ?? opts.buildBaseline();

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

  const prefix = refs.length ? baseline.slice(0, refs[0].from) : baseline;
  const suffix = refs.length ? baseline.slice(refs[refs.length - 1].to) : '';

  const parts: string[] = [];
  let prev: BaselineRef | null = null;
  let first = true;
  doc.forEach((block) => {
    const id = block.attrs.blockId as string;
    const ref = byId.get(id) ?? null;
    const isDirty = dirty.has(id);
    const text = ref && !isDirty ? baseline.slice(ref.from, ref.to) : opts.serialize(block);
    if (!first) {
      if (prev && ref && ref.index === prev.index + 1) {
        parts.push(baseline.slice(prev.to, ref.from));
      } else {
        parts.push(opts.separator);
      }
    }
    parts.push(text);
    prev = ref;
    first = false;
  });

  return prefix + parts.join('') + suffix;
}

/** Markdown reconstruction write-back (unchanged behavior; now a reconcile wrapper). */
export function writeBack(
  doc: PMNode,
  baseline: string,
  dirty: Set<string>,
  flavor: FlavorProfile,
  baselineDoc?: PMNode,
): string {
  return reconcile(
    doc,
    baseline,
    dirty,
    {
      serialize: (b) => serializeBlock(b, flavor),
      separator: '\n\n',
      buildBaseline: () => {
        const r = buildLiveDoc(baseline);
        if (!r.ok) throw new Error(`writeBack: baseline no longer parses (${r.reason})`);
        return r.doc;
      },
    },
    baselineDoc,
  );
}

/** HTML reconstruction write-back — mirrors writeBack with the HTML serializer + a "\n" separator. */
export function htmlWriteBack(
  doc: PMNode,
  baseline: string,
  dirty: Set<string>,
  baselineDoc?: PMNode,
): string {
  return reconcile(
    doc,
    baseline,
    dirty,
    {
      serialize: serializeHtmlBlock,
      separator: '\n',
      buildBaseline: () => {
        const r = toLiveHtml(baseline);
        if (!r.ok) throw new Error(`htmlWriteBack: baseline no longer parses (${r.reason})`);
        return r.doc;
      },
    },
    baselineDoc,
  );
}
