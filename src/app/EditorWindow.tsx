import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Selection } from 'prosemirror-state';
import { WindowChrome, type ViewMode } from './WindowChrome';
import { CloseGuard } from './CloseGuard';
import { useShortcutsAndCloseGuard } from './MenuBridge';
import { CodeView } from '../views/CodeView';
import { LiveView } from '../views/LiveView';
import { RibbonView } from '../ribbon/RibbonView';
import { markdownRibbon } from '../ribbon/markdownRibbon';
import { markdownTableRibbon } from '../ribbon/markdownTableRibbon';
import { isInTable } from '../commands/markdownTableCommands';
import { toLive, writeBack } from '../views/ViewSync';
import { openViaDialog, saveSession } from '../files/fileController';
import { DocumentSession } from '../files/documentSession';
import { basename } from '../files/fileTypes';
import { detectFlavor } from '../doc/flavor';
import { useTheme } from '../settings/useTheme';
import { copyImageIntoAssets, resolveImageDisplaySrc, IMAGE_EXTS } from '../files/imageAssets';
import { insertImage } from '../commands/markdownInlineCommands';

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
  const { mode: themeMode, effective: themeEffective, setMode: setThemeMode } = useTheme();

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
      return toLive(session.text, session?.path ?? null);
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

  // Kept current for the single, mount-once drag-drop listener below.
  const liveViewRef = useRef(liveView);
  liveViewRef.current = liveView;
  const showLiveRef = useRef(showLive);
  showLiveRef.current = showLive;
  const dropDocPathRef = useRef<string | null>(session?.path ?? null);
  dropDocPathRef.current = session?.path ?? null;

  // Local-image drag-drop. Registered ONCE for the window's lifetime; the
  // handler reads the current view/path/mode via refs, so repeated Live<->Code
  // toggles or file switches never accumulate duplicate listeners.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent(async (e) => {
        if (e.payload.type !== 'drop') return;
        const view = liveViewRef.current;
        const docPath = dropDocPathRef.current;
        if (!showLiveRef.current || !view || view.isDestroyed || !docPath) return;
        const imgs = e.payload.paths.filter((p) =>
          IMAGE_EXTS.includes((p.split('.').pop() ?? '').toLowerCase() as (typeof IMAGE_EXTS)[number]),
        );
        if (imgs.length === 0) return; // let non-image drops be
        // Place the cursor at the drop point, snapped to the nearest valid inline
        // position. Selection.near avoids "TextSelection endpoint not pointing
        // into a node with inline content", which previously mis-landed the image.
        const dpr = window.devicePixelRatio || 1;
        const at = view.posAtCoords({ left: e.payload.position.x / dpr, top: e.payload.position.y / dpr });
        if (at) {
          const pos = Math.min(at.pos, view.state.doc.content.size);
          view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos))));
        }
        view.focus();
        for (const path of imgs) {
          try {
            const rel = await copyImageIntoAssets(docPath, path);
            if (disposed || view.isDestroyed) return;
            const display = resolveImageDisplaySrc(rel, docPath);
            insertImage(rel, null, null, display)(view.state, view.dispatch);
          } catch (err) {
            if (!disposed) setError(`Could not insert the dropped image. ${String(err)}`);
          }
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
    // Registered once; the handler reads live values via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        themeMode={themeMode}
        onSetThemeMode={setThemeMode}
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
            {liveView && (
              <RibbonView
                view={liveView}
                controls={markdownRibbon}
                linkRequest={linkRequest}
                docPath={session?.path ?? null}
                onError={setError}
              />
            )}
            {liveView && isInTable(liveView.state) && (
              <div className="ribbon-context">
                <RibbonView
                  view={liveView}
                  controls={markdownTableRibbon}
                  ariaLabel="Table tools"
                  docPath={session?.path ?? null}
                  onError={setError}
                />
              </div>
            )}
            <LiveView
              key={`live-${openCount}`}
              doc={live.doc}
              editable
              onEdit={handleLiveEdit}
              onViewReady={setLiveView}
              onStateChange={bumpRibbon}
              onLinkShortcut={bumpLinkRequest}
              docPath={session?.path ?? null}
              onError={setError}
            />
          </>
        ) : (
          <CodeView
            key={openCount}
            initialText={session.text}
            format={session.format}
            effectiveTheme={themeEffective}
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
