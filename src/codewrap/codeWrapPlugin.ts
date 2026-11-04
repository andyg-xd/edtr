import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { isTextDiagram } from './textDiagram';

export interface CodeWrapState {
  /** Blocks flipped away from their default, keyed by the block's start position. */
  overrides: Map<number, boolean>;
  decorations: DecorationSet;
}

interface ToggleMeta { pos: number }

export const codeWrapKey = new PluginKey<CodeWrapState>('edtrCodeWrap');

// Nodes are immutable and shared between unchanged states, so a block's
// diagram check is paid once per version of its text, not once per keystroke.
const diagramCache = new WeakMap<PMNode, boolean>();

function wrapsByDefault(node: PMNode): boolean {
  let diagram = diagramCache.get(node);
  if (diagram === undefined) {
    diagram = isTextDiagram(node.textContent);
    diagramCache.set(node, diagram);
  }
  return !diagram;
}

function isCodeBlock(node: PMNode | null | undefined): node is PMNode {
  return !!node && node.type === node.type.schema.nodes.codeBlock;
}

/** Start position of the code block holding the selection head, or null. */
function caretBlock(state: EditorState): number | null {
  const $head = state.selection.$head;
  return $head.depth > 0 && isCodeBlock($head.parent) ? $head.before() : null;
}

function wraps(overrides: Map<number, boolean>, node: PMNode, pos: number): boolean {
  return overrides.get(pos) ?? wrapsByDefault(node);
}

function buildDecorations(state: EditorState, overrides: Map<number, boolean>): DecorationSet {
  const caret = caretBlock(state);
  const decos: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (isCodeBlock(node)) {
      const wrap = wraps(overrides, node, pos);
      let cls = wrap ? 'edtr-code edtr-wrap' : 'edtr-code edtr-nowrap';
      if (pos === caret) cls += ' edtr-caret-in';
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: cls }, { wrap }));
    }
    return !node.isTextblock;
  });
  return DecorationSet.create(state.doc, decos);
}

function mapOverrides(overrides: Map<number, boolean>, tr: Transaction, doc: PMNode): Map<number, boolean> {
  const next = new Map<number, boolean>();
  for (const [pos, wrap] of overrides) {
    const r = tr.mapping.mapResult(pos, 1);
    if (r.deleted || !isCodeBlock(doc.nodeAt(r.pos))) continue;
    next.set(r.pos, wrap);
  }
  return next;
}

/**
 * Whether each Markdown Live code block wraps, and the label's state.
 *
 * Display-only: the choice lives in this plugin's state, never in the
 * document, so flipping a block has no step for dirty tracking or history to
 * see (spec: "Per-block state must live outside the document"). It lasts as
 * long as the editor does; a rebuilt Live view starts from the defaults.
 */
export function codeWrapPlugin(): Plugin<CodeWrapState> {
  return new Plugin<CodeWrapState>({
    key: codeWrapKey,
    state: {
      init(_config, state) {
        const overrides = new Map<number, boolean>();
        return { overrides, decorations: buildDecorations(state, overrides) };
      },
      apply(tr, value, oldState, newState) {
        const meta = tr.getMeta(codeWrapKey) as ToggleMeta | undefined;
        if (!tr.docChanged && !meta) {
          // A caret move that stays in (or out of) the same block changes nothing.
          if (!tr.selectionSet || caretBlock(oldState) === caretBlock(newState)) return value;
        }
        let overrides = tr.docChanged ? mapOverrides(value.overrides, tr, newState.doc) : value.overrides;
        if (meta) {
          const node = newState.doc.nodeAt(meta.pos);
          if (isCodeBlock(node)) {
            overrides = new Map(overrides);
            overrides.set(meta.pos, !wraps(overrides, node, meta.pos));
          }
        }
        return { overrides, decorations: buildDecorations(newState, overrides) };
      },
    },
    props: {
      decorations: (state) => codeWrapKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  });
}

/** Whether the code block starting at `pos` wraps: the block's own flip if it has one, else the default. */
export function blockWraps(state: EditorState, pos: number): boolean {
  const node = state.doc.nodeAt(pos);
  if (!isCodeBlock(node)) return false;
  const overrides = codeWrapKey.getState(state)?.overrides;
  return overrides ? wraps(overrides, node, pos) : wrapsByDefault(node);
}

/** Flips the code block starting at `pos`. Meta only, kept out of the undo history. */
export function toggleCodeWrapAt(pos: number): Command {
  return (state, dispatch) => {
    if (!isCodeBlock(state.doc.nodeAt(pos))) return false;
    if (dispatch) {
      dispatch(state.tr.setMeta(codeWrapKey, { pos } satisfies ToggleMeta).setMeta('addToHistory', false));
    }
    return true;
  };
}

/** Flips the code block holding the caret; false (nothing to do) anywhere else. */
export const toggleCodeWrapAtCaret: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.depth === 0 || !isCodeBlock($from.parent)) return false;
  return toggleCodeWrapAt($from.before())(state, dispatch);
};
