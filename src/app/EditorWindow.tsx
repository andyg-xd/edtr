import { useCallback, useMemo, useReducer, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WindowChrome, type ViewMode } from './WindowChrome';
import { CloseGuard } from './CloseGuard';
import { useShortcutsAndCloseGuard } from './MenuBridge';
import { CodeView } from '../views/CodeView';
import { LiveView } from '../views/LiveView';
import { toLive } from '../views/ViewSync';
import { openViaDialog, saveSession } from '../files/fileController';
import { DocumentSession } from '../files/documentSession';
import { basename } from '../files/fileTypes';

export function EditorWindow() {
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [openCount, setOpenCount] = useState(0); // bumps CodeView's key per file
  const [, tick] = useReducer((x: number) => x + 1, 0); // re-render on dirty change
  const [error, setError] = useState<string | null>(null);
  const [showCloseGuard, setShowCloseGuard] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('code');

  const handleOpen = useCallback(async () => {
    try {
      const s = await openViaDialog();
      if (s) {
        setSession(s);
        setOpenCount((n) => n + 1);
        setViewMode('code');
        setError(null);
      }
    } catch (e) {
      setError(`Could not open file: ${String(e)}`);
    }
  }, []);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!session || !session.isDirty()) return true;
    try {
      await saveSession(session);
      tick();
      return true;
    } catch (e) {
      setError(`Could not save — your changes are safe in the editor. ${String(e)}`);
      return false;
    }
  }, [session]);

  const handleChange = useCallback(
    (text: string) => {
      if (!session) return;
      session.setCurrentText(text);
      tick();
    },
    [session],
  );

  const requestClose = useCallback(() => {
    if (session?.isDirty()) {
      setShowCloseGuard(true);
    } else {
      getCurrentWindow().destroy();
    }
  }, [session]);

  useShortcutsAndCloseGuard({ onOpen: handleOpen, onSave: handleSave, onCloseRequest: requestClose });

  const dirty = session?.isDirty() ?? false;

  // Build the read-only Live doc only for a markdown session in Live mode.
  const live = useMemo(() => {
    if (!session || session.format !== 'markdown') return null;
    return toLive(session.text);
    // Re-derive when the file changes (openCount) or the mode flips to live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCount, viewMode, session]);

  const liveAvailable = !!session && session.format === 'markdown' && !!live && live.ok;
  const showLive = viewMode === 'live' && liveAvailable;
  const degraded = viewMode === 'live' && !!session && session.format === 'markdown' && !!live && !live.ok;

  return (
    <div className="editor-window">
      <WindowChrome
        name={session ? basename(session.path) : null}
        dirty={dirty}
        viewMode={showLive ? 'live' : 'code'}
        liveDisabled={!liveAvailable}
        onSetViewMode={(m) => {
          if (m === 'live' && !liveAvailable) return;
          setViewMode(m);
        }}
      />
      {degraded && (
        <div className="notice notice-info" role="status">
          Edtr can't live-edit this file safely — showing Code view.
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {session ? (
        showLive && live && live.ok ? (
          <LiveView key={`live-${openCount}`} doc={live.doc} />
        ) : (
          <CodeView
            key={openCount}
            initialText={session.text}
            format={session.format}
            onChange={handleChange}
          />
        )
      ) : (
        <div className="empty-state">
          <button onClick={handleOpen}>Open a file… (⌘O)</button>
        </div>
      )}
      {showCloseGuard && (
        <CloseGuard
          onSave={async () => {
            const saved = await handleSave();
            if (!saved) {
              setShowCloseGuard(false);
              return;
            }
            setShowCloseGuard(false);
            getCurrentWindow().destroy();
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
