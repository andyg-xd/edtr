import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

interface DirtyState {
  baseline: Map<string, PMNode>;
  dirty: Set<string>;
}

const dirtyKey = new PluginKey<DirtyState>('edtrDirty');

function snapshot(doc: PMNode): Map<string, PMNode> {
  const m = new Map<string, PMNode>();
  doc.forEach((b) => m.set(b.attrs.blockId as string, b));
  return m;
}

/**
 * Tracks which top-level blocks differ from the baseline doc (captured when the
 * editor is created). Dirty = differs-from-baseline (not ever-touched), so an
 * edit-then-revert correctly un-marks the block — preventing a re-serialize of a
 * block whose content is back to the original.
 */
export function dirtyTrackingPlugin(): Plugin<DirtyState> {
  return new Plugin<DirtyState>({
    key: dirtyKey,
    state: {
      init(_config, state) {
        return { baseline: snapshot(state.doc), dirty: new Set() };
      },
      apply(tr, value, _oldState, newState) {
        if (!tr.docChanged) return value;
        const dirty = new Set<string>();
        newState.doc.forEach((b) => {
          const id = b.attrs.blockId as string;
          const base = value.baseline.get(id);
          if (!base || !b.eq(base)) dirty.add(id);
        });
        return { baseline: value.baseline, dirty };
      },
    },
  });
}

export function getDirtyBlockIds(state: EditorState): Set<string> {
  return dirtyKey.getState(state)?.dirty ?? new Set();
}
