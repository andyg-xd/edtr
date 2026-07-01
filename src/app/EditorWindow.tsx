import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WindowChrome, type ViewMode } from './WindowChrome';
import { CloseGuard } from './CloseGuard';
import { useShortcutsAndCloseGuard } from './MenuBridge';
import { CodeView } from '../views/CodeView';
import { LiveView } from '../views/LiveView';
import { RibbonView } from '../ribbon/RibbonView';
import { markdownRibbon } from '../ribbon/markdownRibbon';
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

  const liveBaselineRef = useRef<string>('');           // source when Live was entered
  const liveBaselineDocRef = useRef<PMNode | null>(null); // live doc as of enter-Live
  const liveDocRef = useRef<PMNode | null>(null);       // latest live doc
  const liveDirtyRef = useRef<Set<string>>(new Set());
  const [liveHasEdits, setLiveHasEdits] = useState(false);
  const [liveView, setLiveView] = useState<EditorView | null>(null);
  const [, bumpRibbon] = useReducer((x: number) => x + 1, 0); // re-render ribbon on selection change
  const [linkRequest, bumpLinkRequest] = useReducer((x: number) => x + 1, 0); // ⌘K

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
        setLiveView(null);
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
    // Re-derive when the file changes (openCount) or the mode flips to live,
    // or when session.text is mutated (tracked via version counter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCount, viewMode, session, session?.version]);

  const liveAvailable = !!session && session.format === 'markdown' && !!live && live.ok;
  const showLive = viewMode === 'live' && liveAvailable;
  const degraded = viewMode === 'live' && !!session && session.format === 'markdown' && !!live && !live.ok;

  // Capture the baseline source whenever we (re)enter Live with a fresh doc.
  useEffect(() => {
    if (showLive && live && live.ok) {
      liveBaselineRef.current = session!.text;
      liveBaselineDocRef.current = live.doc;   // stash baseline doc for writeBack
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

  const flushLiveToSource = useCallback((): boolean => {
    if (!session || !liveDocRef.current || liveDirtyRef.current.size === 0) return true;
    const flavor = detectFlavor(liveBaselineRef.current, 'markdown');
    try {
      const newSource = writeBack(
        liveDocRef.current,
        liveBaselineRef.current,
        liveDirtyRef.current,
        flavor,
        liveBaselineDocRef.current ?? undefined,
      );
      session.setCurrentText(newSource);
      liveDirtyRef.current = new Set();
      setLiveHasEdits(false);
      setError(null); // clear any prior serializer-error banner on success
      return true;
    } catch (e) {
      // Never corrupt or lose work: keep the live edits, surface a non-destructive
      // error, stay editable, and report failure so callers don't proceed.
      setError(
        `Edtr couldn't safely convert one of your edits back to Markdown. ` +
          `Your work is still here in Live view. Please adjust that edit and try again. ${String(e)}`,
      );
      return false;
    }
  }, [session]);

  const dirty = (session?.isDirty() ?? false) || liveHasEdits;

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (showLive && !flushLiveToSource()) return false; // flush failed → do not save
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
          if (m === 'code' && showLive && !flushLiveToSource()) return; // flush failed → stay in Live
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
          <>
            {liveView && <RibbonView view={liveView} controls={markdownRibbon} linkRequest={linkRequest} />}
            <LiveView
              key={`live-${openCount}`}
              doc={live.doc}
              editable
              onEdit={handleLiveEdit}
              onViewReady={setLiveView}
              onStateChange={bumpRibbon}
              onLinkShortcut={bumpLinkRequest}
            />
          </>
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
