import { useCallback, useRef, useState } from 'react';
import type { DocumentSession } from '../files/documentSession';
import {
  emptyDocs, open as openDoc, close as closeDoc, setActive as setActiveDoc,
  setViewMode as setViewModeDoc, activeDoc, type OpenDocsState, type ViewMode,
} from '../files/openDocuments';

export function useOpenDocuments() {
  const [state, setState] = useState<OpenDocsState>(emptyDocs);
  const idRef = useRef(0);
  const nextId = useCallback(() => `doc-${idRef.current++}`, []);

  return {
    state,
    active: activeDoc(state),
    /** 5a: open replaces the single visible doc (start fresh). */
    openReplace: useCallback((session: DocumentSession) => setState(openDoc(emptyDocs, session, nextId())), [nextId]),
    /** 5b: append a new doc without discarding the others. */
    open: useCallback((session: DocumentSession) => setState((s) => openDoc(s, session, nextId())), [nextId]),
    close: useCallback((id: string) => setState((s) => closeDoc(s, id)), []),
    setActive: useCallback((id: string) => setState((s) => setActiveDoc(s, id)), []),
    setViewMode: useCallback((id: string, mode: ViewMode) => setState((s) => setViewModeDoc(s, id, mode)), []),
  };
}
