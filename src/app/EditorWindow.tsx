import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WindowChrome, type ViewMode } from './WindowChrome';
import { CloseGuard } from './CloseGuard';
import { useShortcutsAndCloseGuard } from './MenuBridge';
import { CodeView } from '../views/CodeView';
import { LiveView } from '../views/LiveView';
import { toLive, writeBack } from '../views/ViewSync';
import { openViaDialog, saveSession } from '../files/fileController';
import { DocumentSession } from '../files/documentSession';
import { basename } from '../files/fileTypes';
import { detectFlavor } from '../doc/flavor';

export function EditorWindow() {
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [openCount, setOpenCount] = useState(0); // bumps CodeView's key per file
  const [, tick] = useReducer((x: number) => x + 1, 0); // re-render on dirty change
  const [error, setError] = useState<string | null>(null);
  const [showCloseGuard, setShowCloseGuard] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('code');

  const liveBaselineRef = useRef<string>('');      // source when Live was entered
  const liveDocRef = useRef<PMNode | null>(null);  // latest live doc
  const liveDirtyRef = useRef<Set<string>>(new Set());
  const [liveHasEdits, setLiveHasEdits] = useState(false);

  const handleOpen = useCallback(async () => {
    try {
      const s = await openViaDialog();
      if (s) {
        setSession(s);
        setOpenCount((n) => n + 1);
        setViewMode('code');
        setError(null);
        setLiveHasEdits(false);
        liveDocRef.current = null;
        liveDirtyRef.current = new Set();
      }
    } catch (e) {
      setError(`Could not open file: ${String(e)}`);
    }
  }, []);

  const handleChange = useCallback(
    (text: string) => {
      if (!session) return;
      session.setCurrentText(text);
      tick();
    },
    [session],
  );

  // Build the Live doc only for a markdown session; guard against parse errors.
  const live = useMemo(() => {
    if (!session || session.format !== 'markdown') return null;
    try {
      return toLive(session.text);
    } catch (e) {
      return { ok: false as const, degrade: true as const, reason: String(e) };
    }
    // Re-derive when the file changes (openCount) or the mode flips to live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCount, viewMode, session]);

  const liveAvailable = !!session && session.format === 'markdown' && !!live && live.ok;
  const showLive = viewMode === 'live' && liveAvailable;
  const degraded = viewMode === 'live' && !!session && session.format === 'markdown' && !!live && !live.ok;

  // Capture the baseline source whenever we (re)enter Live with a fresh doc.
  useEffect(() => {
    if (showLive && live && live.ok) {
      liveBaselineRef.current = session!.text;
      liveDocRef.current = live.doc;
      liveDirtyRef.current = new Set();
      setLiveHasEdits(false);
    }
    // `session` is intentionally excluded: baseline is (re)captured only on
    // enter-Live (showLive) or file-switch (openCount), never mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLive, openCount]);

  const handleLiveEdit = useCallback((doc: PMNode, dirtyIds: Set<string>) => {
    liveDocRef.current = doc;
    liveDirtyRef.current = dirtyIds;
    setLiveHasEdits(dirtyIds.size > 0);
  }, []);

  const flushLiveToSource = useCallback(() => {
    if (!session || !liveDocRef.current || liveDirtyRef.current.size === 0) return;
    const flavor = detectFlavor(liveBaselineRef.current, 'markdown');
    const newSource = writeBack(liveDocRef.current, liveBaselineRef.current, liveDirtyRef.current, flavor);
    session.setCurrentText(newSource);
  }, [session]);

  const dirty = (session?.isDirty() ?? false) || liveHasEdits;

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (showLive) flushLiveToSource();
    if (!session || !session.isDirty()) {
      setLiveHasEdits(false);
      return true;
    }
    try {
      await saveSession(session);
      setLiveHasEdits(false);
      tick();
      return true;
    } catch (e) {
      setError(`Could not save — your changes are safe in the editor. ${String(e)}`);
      return false;
    }
  }, [session, showLive, flushLiveToSource]);

  const requestClose = useCallback(() => {
    if (dirty) setShowCloseGuard(true);
    else getCurrentWindow().destroy();
  }, [dirty]);

  useShortcutsAndCloseGuard({ onOpen: handleOpen, onSave: handleSave, onCloseRequest: requestClose });

  return (
    <div className="editor-window">
      <WindowChrome
        name={session ? basename(session.path) : null}
        dirty={dirty}
        viewMode={showLive ? 'live' : 'code'}
        liveDisabled={!liveAvailable}
        onSetViewMode={(m) => {
          if (m === 'live' && !liveAvailable) return;
          if (m === 'code' && showLive) flushLiveToSource(); // fold edits into source before showing Code
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
          <LiveView key={`live-${openCount}`} doc={live.doc} editable onEdit={handleLiveEdit} />
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
            setLiveHasEdits(false);
            setShowCloseGuard(false);
            getCurrentWindow().destroy();
          }}
          onCancel={() => setShowCloseGuard(false)}
        />
      )}
    </div>
  );
}
