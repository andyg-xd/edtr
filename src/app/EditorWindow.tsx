import { useCallback, useReducer, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WindowChrome } from './WindowChrome';
import { CloseGuard } from './CloseGuard';
import { useShortcutsAndCloseGuard } from './MenuBridge';
import { CodeView } from '../views/CodeView';
import { openViaDialog, saveSession } from '../files/fileController';
import { DocumentSession } from '../files/documentSession';
import { basename } from '../files/fileTypes';

export function EditorWindow() {
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [openCount, setOpenCount] = useState(0); // bumps CodeView's key per file
  const [, tick] = useReducer((x: number) => x + 1, 0); // re-render on dirty change
  const [error, setError] = useState<string | null>(null);
  const [showCloseGuard, setShowCloseGuard] = useState(false);

  const handleOpen = useCallback(async () => {
    try {
      const s = await openViaDialog();
      if (s) {
        setSession(s);
        setOpenCount((n) => n + 1);
        setError(null);
      }
    } catch (e) {
      setError(`Could not open file: ${String(e)}`);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!session || !session.isDirty()) return;
    try {
      await saveSession(session);
      tick();
    } catch (e) {
      setError(`Could not save — your changes are safe in the editor. ${String(e)}`);
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

  return (
    <div className="editor-window">
      <WindowChrome name={session ? basename(session.path) : null} dirty={dirty} />
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {session ? (
        <CodeView
          key={openCount}
          initialText={session.text}
          format={session.format}
          onChange={handleChange}
        />
      ) : (
        <div className="empty-state">
          <button onClick={handleOpen}>Open a file… (⌘O)</button>
        </div>
      )}
      {showCloseGuard && (
        <CloseGuard
          onSave={async () => {
            await handleSave();
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
