import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { WindowChrome } from './WindowChrome';
import { CloseGuard } from './CloseGuard';
import { Sidebar } from './Sidebar';
import { FolderSidebar } from './FolderSidebar';
import { useMenuAndCloseGuard } from './MenuBridge';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { openViaDialog, saveSession, pickFolder, readFolder, readSession } from '../files/fileController';
import { basename } from '../files/fileTypes';
import { useTheme } from '../settings/useTheme';
import { useOpenDocuments } from './useOpenDocuments';
import { docIsDirty, windowIsDirty, type OpenDoc, type ViewMode } from '../files/openDocuments';
import type { DocumentSession } from '../files/documentSession';
import type { FolderEntry } from '../files/folder';

type FolderView = { path: string; entries: FolderEntry[] };

type PendingIntent =
  | { kind: 'close-window' }
  | { kind: 'quit' }
  | { kind: 'close-doc'; id: string }
  | { kind: 'open-folder'; folder: FolderView }
  | { kind: 'open-loose'; sessions: DocumentSession[] }
  | null;

export function EditorWindow() {
  const docs = useOpenDocuments();
  const active = docs.active;
  const [error, setError] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent>(null);
  const [activeDirty, setActiveDirty] = useState(false);
  const [activeLiveAvailable, setActiveLiveAvailable] = useState(false);
  const [folderView, setFolderView] = useState<FolderView | null>(null);
  const { mode: themeMode, effective: themeEffective, setMode: setThemeMode } = useTheme();
  const viewRef = useRef<DocumentViewHandle>(null);

  // TEMP spike probe (removed in Task 4): claim this window's pending-open
  // payload (if any) on mount and log it, to prove the handoff round-trips.
  useEffect(() => {
    invoke('take_pending_open').then((payload) => {
      console.log('[spike] take_pending_open ->', payload);
    });
  }, []);

  // Flush the active doc's pending Live edits into its session before it goes
  // inactive (switch/open). false = a serializer throw aborted it.
  const flushActive = useCallback((): boolean => {
    if (active && active.viewMode === 'live' && activeLiveAvailable && viewRef.current) {
      return viewRef.current.flushToSource();
    }
    return true;
  }, [active, activeLiveAvailable]);

  // Reset the active-status flags whenever the active doc changes wholesale.
  const resetActiveFlags = useCallback(() => {
    setError(null);
    setActiveDirty(false);
    setActiveLiveAvailable(false);
  }, []);

  const windowDirty = windowIsDirty(docs.state, activeDirty);

  // Replace the working set with a fresh folder context: empty the store (the
  // user loads files by clicking), then show the folder. Entries already read.
  const enterFolder = useCallback((folder: FolderView) => {
    for (const d of docs.state.docs) docs.close(d.id);
    setFolderView(folder);
    resetActiveFlags();
  }, [docs, resetActiveFlags]);

  // Replace the working set with loose docs-mode sessions (leaves folder-mode).
  const enterLooseDocs = useCallback((sessions: DocumentSession[]) => {
    setFolderView(null);
    if (sessions.length > 0) {
      docs.openReplace(sessions[0]);
      for (let i = 1; i < sessions.length; i++) docs.open(sessions[i]);
    }
    resetActiveFlags();
  }, [docs, resetActiveFlags]);

  // ⌘O / File → Open. docs-mode: append (5b-i). folder-mode: leave folder-mode
  // → open the picked files fresh (guarding the dirty folder set first).
  const handleOpen = useCallback(async () => {
    try {
      const sessions = await openViaDialog();
      if (sessions.length === 0) return;
      if (folderView) {
        if (windowDirty) { setPendingIntent({ kind: 'open-loose', sessions }); return; }
        if (!flushActive()) return;
        enterLooseDocs(sessions);
      } else {
        if (!flushActive()) return;
        for (const s of sessions) docs.open(s);
        resetActiveFlags();
      }
    } catch (e) {
      setError(`Could not open file: ${String(e)}`);
    }
  }, [folderView, windowDirty, flushActive, enterLooseDocs, docs, resetActiveFlags]);

  // File → Open Folder…: read the folder (fail fast on error, no state change),
  // then enter folder-mode, guarding the current working set if it's dirty.
  const handleOpenFolder = useCallback(async () => {
    try {
      const path = await pickFolder();
      if (path == null) return;
      const entries = await readFolder(path);
      const folder: FolderView = { path, entries };
      if (windowDirty) { setPendingIntent({ kind: 'open-folder', folder }); return; }
      if (!flushActive()) return;
      enterFolder(folder);
    } catch (e) {
      setError(`Could not open folder: ${String(e)}`);
    }
  }, [windowDirty, flushActive, enterFolder]);

  const dirtyFor = useCallback(
    (doc: OpenDoc) => docIsDirty(doc, active?.id ?? null, activeDirty),
    [active, activeDirty],
  );

  const findDoc = useCallback(
    (id: string) => docs.state.docs.find((d) => d.id === id),
    [docs.state.docs],
  );

  const selectDoc = useCallback((id: string) => {
    if (id === active?.id) return;
    if (!flushActive()) return;
    setError(null);
    const target = findDoc(id);
    setActiveDirty(target ? target.session.isDirty() : false);
    setActiveLiveAvailable(false);
    docs.setActive(id);
  }, [active, docs, flushActive, findDoc]);

  // Folder-sidebar click: activate the doc if already open, else load + open it.
  const openPath = useCallback(async (path: string) => {
    const existing = docs.state.docs.find((d) => d.session.path === path);
    if (existing) { selectDoc(existing.id); return; }
    if (!flushActive()) return;
    try {
      const session = await readSession(path);
      resetActiveFlags();
      docs.open(session);
    } catch (e) {
      setError(`Could not open file: ${String(e)}`);
    }
  }, [docs, selectDoc, flushActive, resetActiveFlags]);

  // Save one doc (flush first if it's the active/live doc). false = failure.
  const saveDoc = useCallback(async (id: string): Promise<boolean> => {
    const doc = findDoc(id);
    if (!doc) return true;
    if (id === active?.id && !flushActive()) return false;
    if (!doc.session.isDirty()) { if (id === active?.id) setActiveDirty(false); return true; }
    try {
      await saveSession(doc.session);
      if (id === active?.id) setActiveDirty(false);
      return true;
    } catch (e) {
      setError(`Could not save "${basename(doc.session.path)}" — your changes are safe in the editor. ${String(e)}`);
      return false;
    }
  }, [active, flushActive, findDoc]);

  const saveAllDirty = useCallback(async (): Promise<boolean> => {
    if (!flushActive()) return false;
    for (const doc of docs.state.docs) {
      if (!doc.session.isDirty()) continue;
      try {
        await saveSession(doc.session);
      } catch (e) {
        setError(`Could not save "${basename(doc.session.path)}" — your changes are safe in the editor. ${String(e)}`);
        return false;
      }
    }
    setActiveDirty(false);
    return true;
  }, [docs, flushActive]);

  // ⌘S / File → Save: active doc only.
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!active) return true;
    return saveDoc(active.id);
  }, [active, saveDoc]);

  const closeDoc = useCallback((id: string) => {
    const doc = findDoc(id);
    if (!doc) return;
    if (dirtyFor(doc)) setPendingIntent({ kind: 'close-doc', id });
    else docs.close(id);
  }, [docs, dirtyFor, findDoc]);

  const proceedExit = useCallback((kind: 'close-window' | 'quit') => {
    if (kind === 'quit') invoke('quit_app');
    else getCurrentWindow().destroy();
  }, []);
  const requestClose = useCallback(() => {
    if (windowDirty) setPendingIntent({ kind: 'close-window' });
    else proceedExit('close-window');
  }, [windowDirty, proceedExit]);
  const requestQuit = useCallback(() => {
    if (windowDirty) setPendingIntent({ kind: 'quit' });
    else proceedExit('quit');
  }, [windowDirty, proceedExit]);

  useMenuAndCloseGuard({
    onOpen: handleOpen,
    onOpenFolder: handleOpenFolder,
    onSave: handleSave,
    onCloseRequest: requestClose,
    onQuitRequest: requestQuit,
  });

  const effectiveViewMode: ViewMode = active && active.viewMode === 'live' && activeLiveAvailable ? 'live' : 'code';
  const degraded = !!active && active.viewMode === 'live' && !activeLiveAvailable;

  const activePath = active?.session.path ?? null;
  const openPaths = useMemo(
    () => new Set(docs.state.docs.map((d) => d.session.path)),
    [docs.state.docs],
  );
  const dirtyForPath = useCallback((path: string) => {
    const doc = docs.state.docs.find((d) => d.session.path === path);
    return doc ? docIsDirty(doc, active?.id ?? null, activeDirty) : false;
  }, [docs.state.docs, active, activeDirty]);

  // Guard actions branch on the pending intent.
  const guardProceed = (intent: Exclude<PendingIntent, null>) => {
    switch (intent.kind) {
      case 'close-doc': docs.close(intent.id); break;
      case 'open-folder': enterFolder(intent.folder); break;
      case 'open-loose': enterLooseDocs(intent.sessions); break;
      case 'close-window':
      case 'quit': proceedExit(intent.kind); break;
      default: { const _exhaustive: never = intent; void _exhaustive; break; }
    }
  };
  const onGuardSave = async () => {
    const intent = pendingIntent;
    if (!intent) return;
    const ok = intent.kind === 'close-doc' ? await saveDoc(intent.id) : await saveAllDirty();
    setPendingIntent(null);
    if (ok) guardProceed(intent);
  };
  const onGuardDiscard = () => {
    const intent = pendingIntent;
    setPendingIntent(null);
    if (intent) guardProceed(intent);
  };

  return (
    <div className="editor-window">
      <WindowChrome
        name={active ? basename(active.session.path) : null}
        dirty={active ? activeDirty : false}
        viewMode={effectiveViewMode}
        liveDisabled={!activeLiveAvailable}
        onSetViewMode={(m) => {
          if (!active) return;
          if (m === 'live' && !activeLiveAvailable) return;
          if (m === 'code' && active.viewMode === 'live' && activeLiveAvailable && viewRef.current && !viewRef.current.flushToSource()) return;
          docs.setViewMode(active.id, m);
        }}
        themeMode={themeMode}
        onSetThemeMode={setThemeMode}
      />
      {degraded && (
        <div className="notice notice-info" role="status">
          Edtr can't live-edit this file safely — showing Code view.
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">{error}</div>
      )}
      <div className="editor-body">
        {folderView ? (
          <FolderSidebar
            entries={folderView.entries}
            activePath={activePath}
            openPaths={openPaths}
            dirtyForPath={dirtyForPath}
            onOpen={openPath}
          />
        ) : (
          docs.state.docs.length > 1 && (
            <Sidebar
              docs={docs.state.docs}
              activeId={docs.state.activeId}
              dirtyFor={dirtyFor}
              onSelect={selectDoc}
              onClose={closeDoc}
            />
          )
        )}
        <div className="doc-pane">
          {active ? (
            <DocumentView
              key={active.id}
              ref={viewRef}
              doc={active}
              effectiveTheme={themeEffective}
              onDirtyChange={setActiveDirty}
              onLiveAvailableChange={setActiveLiveAvailable}
              onError={setError}
            />
          ) : folderView ? (
            folderView.entries.length === 0 ? (
              <div className="empty-state">
                <p>This folder has no editable files.</p>
                <button onClick={handleOpen}>Open a file… (⌘O)</button>
              </div>
            ) : (
              <div className="empty-state">Select a file from the sidebar to start editing.</div>
            )
          ) : (
            <div className="empty-state">
              <button onClick={handleOpen}>Open a file… (⌘O)</button>
              {/* TEMP spike probe (removed in Task 4): prove open_in_new_window
                  spawns an independent second window. */}
              <button
                onClick={() => invoke('open_in_new_window', { payload: { kind: 'files', paths: [] } })}
              >
                [spike] Open in new window
              </button>
            </div>
          )}
        </div>
      </div>
      {pendingIntent && (
        <CloseGuard onSave={onGuardSave} onDiscard={onGuardDiscard} onCancel={() => setPendingIntent(null)} />
      )}
    </div>
  );
}
