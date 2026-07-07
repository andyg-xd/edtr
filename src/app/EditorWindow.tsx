import { useCallback, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WindowChrome } from './WindowChrome';
import { CloseGuard } from './CloseGuard';
import { useShortcutsAndCloseGuard } from './MenuBridge';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { openViaDialog, saveSession } from '../files/fileController';
import { DocumentSession } from '../files/documentSession';
import { basename } from '../files/fileTypes';
import { useTheme } from '../settings/useTheme';
import type { OpenDoc, ViewMode } from '../files/openDocuments';

export function EditorWindow() {
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('code');
  const [error, setError] = useState<string | null>(null);
  const [showCloseGuard, setShowCloseGuard] = useState(false);
  const [activeDirty, setActiveDirty] = useState(false);
  const [activeLiveAvailable, setActiveLiveAvailable] = useState(false);
  const { mode: themeMode, effective: themeEffective, setMode: setThemeMode } = useTheme();
  const viewRef = useRef<DocumentViewHandle>(null);

  const active: OpenDoc | null = session ? { id: String(openCount), session, viewMode } : null;

  const handleOpen = useCallback(async () => {
    try {
      const s = await openViaDialog();
      if (s) {
        setSession(s);
        setOpenCount((n) => n + 1);
        setViewMode('code');
        setError(null);
        setActiveDirty(false);
        setActiveLiveAvailable(false);
      }
    } catch (e) {
      setError(`Could not open file: ${String(e)}`);
    }
  }, []);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!active) return true;
    if (active.viewMode === 'live' && viewRef.current && !viewRef.current.flushToSource()) return false;
    if (!active.session.isDirty()) { setActiveDirty(false); return true; }
    try {
      await saveSession(active.session);
      setActiveDirty(false);
      return true;
    } catch (e) {
      setError(`Could not save — your changes are safe in the editor. ${String(e)}`);
      return false;
    }
  }, [active]);

  const dirty = active ? activeDirty : false;
  const requestClose = useCallback(() => {
    if (dirty) setShowCloseGuard(true);
    else getCurrentWindow().destroy();
  }, [dirty]);

  useShortcutsAndCloseGuard({ onOpen: handleOpen, onSave: handleSave, onCloseRequest: requestClose });

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
          if (m === 'code' && active.viewMode === 'live' && viewRef.current && !viewRef.current.flushToSource()) return;
          setViewMode(m);
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
      {showCloseGuard && (
        <CloseGuard
          onSave={async () => {
            const saved = await handleSave();
            setShowCloseGuard(false);
            if (saved) getCurrentWindow().destroy();
          }}
          onDiscard={() => {
            setShowCloseGuard(false);
            getCurrentWindow().destroy();
          }}
          onCancel={() => setShowCloseGuard(false)}
        />
      )}
    </div>
  );
}
