import { useCallback, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { WindowChrome } from './WindowChrome';
import { CloseGuard } from './CloseGuard';
import { Sidebar } from './Sidebar';
import { useMenuAndCloseGuard } from './MenuBridge';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { openViaDialog, saveSession } from '../files/fileController';
import { basename } from '../files/fileTypes';
import { useTheme } from '../settings/useTheme';
import { useOpenDocuments } from './useOpenDocuments';
import { docIsDirty, windowIsDirty, type OpenDoc, type ViewMode } from '../files/openDocuments';

type PendingIntent =
  | { kind: 'close-window' }
  | { kind: 'quit' }
  | { kind: 'close-doc'; id: string }
  | null;

export function EditorWindow() {
  const docs = useOpenDocuments();
  const active = docs.active;
  const [error, setError] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent>(null);
  const [activeDirty, setActiveDirty] = useState(false);
  const [activeLiveAvailable, setActiveLiveAvailable] = useState(false);
  const { mode: themeMode, effective: themeEffective, setMode: setThemeMode } = useTheme();
  const viewRef = useRef<DocumentViewHandle>(null);

  // Flush the active doc's pending Live edits into its session before it goes
  // inactive (switch/open). false = a serializer throw aborted it.
  const flushActive = useCallback((): boolean => {
    if (active && active.viewMode === 'live' && activeLiveAvailable && viewRef.current) {
      return viewRef.current.flushToSource();
    }
    return true;
  }, [active, activeLiveAvailable]);

  const handleOpen = useCallback(async () => {
    try {
      const sessions = await openViaDialog();
      if (sessions.length === 0) return;
      if (!flushActive()) return; // don't lose the outgoing doc's unflushable edit
      for (const s of sessions) docs.open(s);
      setError(null);
      setActiveDirty(false);
      setActiveLiveAvailable(false);
    } catch (e) {
      setError(`Could not open file: ${String(e)}`);
    }
  }, [docs, flushActive]);

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

  const windowDirty = windowIsDirty(docs.state, activeDirty);
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

  const handleOpenFolder = useCallback(() => {
    // TODO: Implement open-folder behavior in a later task
  }, []);

  useMenuAndCloseGuard({
    onOpen: handleOpen,
    onOpenFolder: handleOpenFolder,
    onSave: handleSave,
    onCloseRequest: requestClose,
    onQuitRequest: requestQuit,
  });

  const effectiveViewMode: ViewMode = active && active.viewMode === 'live' && activeLiveAvailable ? 'live' : 'code';
  const degraded = !!active && active.viewMode === 'live' && !activeLiveAvailable;

  // Guard actions branch on the pending intent.
  const guardProceed = (intent: Exclude<PendingIntent, null>) => {
    if (intent.kind === 'close-doc') docs.close(intent.id);
    else proceedExit(intent.kind);
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
        {docs.state.docs.length > 1 && (
          <Sidebar
            docs={docs.state.docs}
            activeId={docs.state.activeId}
            dirtyFor={dirtyFor}
            onSelect={selectDoc}
            onClose={closeDoc}
          />
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
          ) : (
            <div className="empty-state">
              <button onClick={handleOpen}>Open a file… (⌘O)</button>
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
