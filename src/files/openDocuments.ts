import type { DocumentSession } from './documentSession';

/** Which view a document is showing. Structurally identical to WindowChrome's ViewMode. */
export type ViewMode = 'code' | 'live';

export interface OpenDoc {
  id: string;
  session: DocumentSession;
  viewMode: ViewMode;
}

export interface OpenDocsState {
  docs: OpenDoc[];
  activeId: string | null;
}

export const emptyDocs: OpenDocsState = { docs: [], activeId: null };

/** Append a document and make it active. `id` is supplied by the caller (the hook mints ids). */
export function open(state: OpenDocsState, session: DocumentSession, id: string): OpenDocsState {
  const doc: OpenDoc = { id, session, viewMode: 'code' };
  return { docs: [...state.docs, doc], activeId: id };
}

/** Remove a document. If it was active, reselect a neighbor (previous index, clamped), else null. */
export function close(state: OpenDocsState, id: string): OpenDocsState {
  const idx = state.docs.findIndex((d) => d.id === id);
  if (idx === -1) return state;
  const docs = state.docs.filter((d) => d.id !== id);
  let activeId = state.activeId;
  if (state.activeId === id) {
    const neighbor = docs[Math.min(idx, docs.length - 1)];
    activeId = neighbor ? neighbor.id : null;
  }
  return { docs, activeId };
}

export function setActive(state: OpenDocsState, id: string): OpenDocsState {
  if (!state.docs.some((d) => d.id === id)) return state;
  return { ...state, activeId: id };
}

export function setViewMode(state: OpenDocsState, id: string, mode: ViewMode): OpenDocsState {
  return { ...state, docs: state.docs.map((d) => (d.id === id ? { ...d, viewMode: mode } : d)) };
}

export function activeDoc(state: OpenDocsState): OpenDoc | null {
  return state.docs.find((d) => d.id === state.activeId) ?? null;
}

export function anyDirty(state: OpenDocsState): boolean {
  return state.docs.some((d) => d.session.isDirty());
}

/** Whether a doc is dirty: the active doc uses `activeDirty` (which includes
 * unflushed Live edits); inactive docs are captured by their session. */
export function docIsDirty(doc: OpenDoc, activeId: string | null, activeDirty: boolean): boolean {
  return doc.id === activeId ? activeDirty : doc.session.isDirty();
}

/** Whether the window has any unsaved work (any dirty session, or the active
 * doc's unflushed Live edits). Drives the window-close / quit guard. */
export function windowIsDirty(state: OpenDocsState, activeDirty: boolean): boolean {
  return anyDirty(state) || activeDirty;
}
