import { useCallback, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { WindowChrome } from './WindowChrome';
import { CloseGuard } from './CloseGuard';
import { useMenuAndCloseGuard } from './MenuBridge';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { openViaDialog, saveSession } from '../files/fileController';
import { basename } from '../files/fileTypes';
import { useTheme } from '../settings/useTheme';
import { useOpenDocuments } from './useOpenDocuments';
import type { ViewMode } from '../files/openDocuments';

export function EditorWindow() {
  const docs = useOpenDocuments();
  const active = docs.active;
  const [error, setError] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<'close' | 'quit' | null>(null);
  const [activeDirty, setActiveDirty] = useState(false);
  const [activeLiveAvailable, setActiveLiveAvailable] = useState(false);
  const { mode: themeMode, effective: themeEffective, setMode: setThemeMode } = useTheme();
  const viewRef = useRef<DocumentViewHandle>(null);

  const handleOpen = useCallback(async () => {
    try {
      const s = await openViaDialog();
      if (s) {
        docs.openReplace(s); // 5a: open replaces the single active doc (today's behavior)
        setError(null);
        setActiveDirty(false);
        setActiveLiveAvailable(false);
      }
    } catch (e) {
      setError(`Could not open file: ${String(e)}`);
    }
  }, [docs]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!active) return true;
    if (active.viewMode === 'live' && activeLiveAvailable && viewRef.current && !viewRef.current.flushToSource()) return false;
    if (!active.session.isDirty()) { setActiveDirty(false); return true; }
    try {
      await saveSession(active.session);
      setActiveDirty(false);
      return true;
    } catch (e) {
      setError(`Could not save — your changes are safe in the editor. ${String(e)}`);
      return false;
    }
  }, [active, activeLiveAvailable]);

  const dirty = active ? activeDirty : false;
  const proceedExit = useCallback((intent: 'close' | 'quit') => {
    if (intent === 'quit') invoke('quit_app');
    else getCurrentWindow().destroy();
  }, []);
  const requestClose = useCallback(() => {
    if (dirty) setPendingIntent('close');
    else proceedExit('close');
  }, [dirty, proceedExit]);
  const requestQuit = useCallback(() => {
    if (dirty) setPendingIntent('quit');
    else proceedExit('quit');
  }, [dirty, proceedExit]);

  useMenuAndCloseGuard({
    onOpen: handleOpen,
    onSave: handleSave,
    onCloseRequest: requestClose,
    onQuitRequest: requestQuit,
  });

  const effectiveViewMode: ViewMode = active && active.viewMode === 'live' && activeLiveAvailable ? 'live' : 'code';
  const degraded = !!active && active.viewMode === 'live' && !activeLiveAvailable;

  return (
    <div className="editor-window">
      <WindowChrome
        name={active ? basename(active.session.path) : null}
        dirty={dirty}
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
      {pendingIntent && (
        <CloseGuard
          onSave={async () => {
            const intent = pendingIntent;
            const saved = await handleSave();
            setPendingIntent(null);
            if (saved && intent) proceedExit(intent);
          }}
          onDiscard={() => {
            const intent = pendingIntent;
            setPendingIntent(null);
            if (intent) proceedExit(intent);
          }}
          onCancel={() => setPendingIntent(null)}
        />
      )}
    </div>
  );
}
