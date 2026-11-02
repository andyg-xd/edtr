/**
 * Asked by an editor whose own history is used up: take one whole-view step
 * (see `DocHistory`). Returns whether a step was taken; false leaves the key
 * or menu command to the editor, exactly as it was before.
 */
export type HistoryEdge = (direction: 'undo' | 'redo') => boolean;
