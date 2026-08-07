import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState,
} from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type { EditorView as CMEditorView } from '@codemirror/view';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { CodeView } from '../views/CodeView';
import { LiveView } from '../views/LiveView';
import { toLiveHtml, type HtmlLiveResult } from '../views/htmlModel';
import { HtmlLiveView } from '../views/HtmlLiveView';
import { RibbonView } from '../ribbon/RibbonView';
import { markdownRibbon } from '../ribbon/markdownRibbon';
import { markdownTableRibbon } from '../ribbon/markdownTableRibbon';
import { isInTable } from '../commands/markdownTableCommands';
import { toLive, writeBack, htmlWriteBack } from '../views/ViewSync';
import { htmlRibbon } from '../ribbon/htmlRibbon';
import { htmlTableRibbon } from '../ribbon/htmlTableRibbon';
import { isInTable as isHtmlInTable } from '../commands/htmlTableCommands';
import { detectFlavor } from '../doc/flavor';
import { copyImageIntoAssets, resolveImageDisplaySrc, IMAGE_EXTS } from '../files/imageAssets';
import { insertImage, canInsertImage as mdCanInsertImage } from '../commands/markdownInlineCommands';
import { insertImage as htmlInsertImage, canInsertImage as htmlCanInsertImage } from '../commands/htmlInlineCommands';
import type { OpenDoc } from '../files/openDocuments';
import { StatusBar } from './StatusBar';
import { FindBar } from '../find/FindBar';
import { codeSurface } from '../find/codeSurface';
import { pmSurface } from '../find/pmSurface';
import { matchSegments } from '../find/matchText';
import type { FindQuery } from '../find/findQuery';
import {
  clear as clearFind, countLabel, currentMatch, emptyFindState,
  next as nextMatch, prev as prevMatch, setResult, type FindState,
} from '../find/findState';
import type { FindSurface } from '../find/types';

/**
 * Matching is debounced so a fast typist doesn't re-scan the document on every
 * keystroke. 120ms mirrors --motion-fast; a pathological pattern on a large
 * document can still stall briefly (design §7.2).
 */
const FIND_DEBOUNCE_MS = 120;

export interface DocumentViewHandle {
  /** Flush live edits into doc.session.currentText. Returns false if a serializer throw aborted it. */
  flushToSource: () => boolean;
  /** ⌘F — open the find bar, seeding it from the selection, or refocus it if already open. */
  openFind: () => void;
  findNext: () => void;
  findPrev: () => void;
}

/**
 * Derives a status-bar position from a ProseMirror selection, shared by both
 * Live views (Markdown and HTML) since both mount a plain EditorView and route
 * every transaction — including selection-only ones — through onStateChange.
 * "Line" has no literal meaning in rich text, so it's the 1-based index of the
 * cursor's TOP-LEVEL block (paragraph/heading/list/table/…) — honest and
 * stable, unlike a source line number the view has no way to know. "Column" is
 * the 1-based offset within that block's immediate parent node.
 */
function livePosition(view: EditorView | null): { line: number; column: number } | null {
  if (!view) return null;
  const $head = view.state.selection.$head;
  return { line: $head.index(0) + 1, column: $head.parentOffset + 1 };
}

interface DocumentViewProps {
  doc: OpenDoc;
  effectiveTheme: 'light' | 'dark';
  onDirtyChange: (dirty: boolean) => void;
  onLiveAvailableChange: (available: boolean) => void;
  onError: (msg: string | null) => void;
}

export const DocumentView = forwardRef<DocumentViewHandle, DocumentViewProps>(function DocumentView(
  { doc, effectiveTheme, onDirtyChange, onLiveAvailableChange, onError }, ref,
) {
  const session = doc.session;
  const viewMode = doc.viewMode;
  const [, tick] = useReducer((x: number) => x + 1, 0);

  const liveBaselineRef = useRef<string>('');
  const liveBaselineDocRef = useRef<PMNode | null>(null);
  const liveDocRef = useRef<PMNode | null>(null);
  const liveDirtyRef = useRef<Set<string>>(new Set());
  const [liveHasEdits, setLiveHasEdits] = useState(false);
  const [liveView, setLiveView] = useState<EditorView | null>(null);
  const [, bumpRibbon] = useReducer((x: number) => x + 1, 0);
  const [linkRequest, bumpLinkRequest] = useReducer((x: number) => x + 1, 0);
  // Code view's caret position, for the status bar. Reset on every Code<->Live
  // transition so a stale position from before the switch is never shown —
  // CodeView reports its real position again the instant it (re)mounts.
  const [codeCursor, setCodeCursor] = useState<{ line: number; column: number } | null>(null);

  const [codeView, setCodeView] = useState<CMEditorView | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState<FindState>(emptyFindState);
  // Which surface produced `find.matches`. A Code<->Live toggle deliberately
  // KEEPS the query and the open bar (design §5.4), but the matches are
  // document positions belonging to the projection that produced them -- a
  // source offset means nothing in the Live doc, and vice versa. `surface`
  // swaps identity in the same commit as the toggle, while the recompute is a
  // debounce behind, so anything that consumes matches must first check that
  // they belong to the surface it is about to touch. Without this, reveal()
  // resolves an out-of-range position and throws out of a passive effect,
  // which takes the whole window down.
  const [findFor, setFindFor] = useState<FindSurface | null>(null);
  // Which document VERSION `find.matches` describes, alongside `findFor`.
  // `findFor === surface` alone catches a projection swap but not an edit
  // WITHIN one projection: after an in-place edit, `bumpFindEpoch` only
  // reschedules the debounced recompute -- `find.matches` stays stale while
  // `findFor` is still the (unchanged) current surface, so that guard alone
  // would pass. ⌘G/⇧⌘G are always live through the native menu, so a user can
  // land on a stale `find.current` inside that window and reveal() a position
  // the just-edited document no longer has.
  const [findForEpoch, setFindForEpoch] = useState(-1);
  const [findFocusToken, bumpFindFocus] = useReducer((x: number) => x + 1, 0);
  // Bumped ONLY by a real document change (see the two call sites). Highlighting
  // and revealing must never bump it: both dispatch transactions, so a recompute
  // triggered by them would re-highlight and loop forever.
  const [findEpoch, bumpFindEpoch] = useReducer((x: number) => x + 1, 0);
  // Where `setResult` starts looking for "the match nearest the user" — set
  // once when find opens, and again on each empty->non-empty query transition
  // (both capture sites are below), NEVER read live from the surface at
  // recompute time. By the time the debounced recompute runs, `reveal()` has
  // already moved the selection to the PREVIOUS current match, so a live
  // `surface.cursorPos()` would anchor every keystroke's search on where the
  // LAST keystroke's match landed rather than where the user actually is —
  // under typing slower than the debounce, the current match hunts forward
  // and eventually wraps instead of staying still. Do not "simplify" this
  // back to a live read.
  const findAnchorRef = useRef(0);

  const handleChange = useCallback((text: string) => {
    session.setCurrentText(text);
    bumpFindEpoch(); // a real document change — find must re-scan
    tick();
  }, [session]);

  const live = useMemo(() => {
    if (session.format !== 'markdown') return null;
    try { return toLive(session.text, session.path ?? null); }
    catch (e) { return { ok: false as const, degrade: true as const, reason: String(e) }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, session, session.version]);

  const liveHtml = useMemo<HtmlLiveResult | null>(() => {
    if (session.format !== 'html') return null;
    try { return toLiveHtml(session.text, session.path ?? null); }
    catch (e) { return { ok: false as const, degrade: true as const, reason: String(e) }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, session, session.version]);

  const liveAvailable =
    (session.format === 'markdown' && !!live && live.ok) ||
    (session.format === 'html' && !!liveHtml && liveHtml.ok);
  const showLive = viewMode === 'live' && liveAvailable;

  useEffect(() => { onLiveAvailableChange(liveAvailable); }, [liveAvailable, onLiveAvailableChange]);
  const dirty = session.isDirty() || liveHasEdits;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  // Capture the baseline source on enter-Live. (No openCount dep: the component
  // remounts per doc.id, so a file switch already gives a fresh baseline.)
  useEffect(() => {
    const active = session.format === 'html' ? liveHtml : session.format === 'markdown' ? live : null;
    if (showLive && active && active.ok) {
      liveBaselineRef.current = session.text;
      liveBaselineDocRef.current = active.doc;
      liveDocRef.current = active.doc;
      liveDirtyRef.current = new Set();
      setLiveHasEdits(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLive]);

  useEffect(() => { setCodeCursor(null); }, [showLive]);

  const liveViewRef = useRef(liveView); liveViewRef.current = liveView;
  const showLiveRef = useRef(showLive); showLiveRef.current = showLive;
  const dropDocPathRef = useRef<string | null>(session.path ?? null); dropDocPathRef.current = session.path ?? null;
  const dropFormatRef = useRef(session.format); dropFormatRef.current = session.format;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview().onDragDropEvent(async (e) => {
      if (e.payload.type !== 'drop') return;
      const view = liveViewRef.current;
      const docPath = dropDocPathRef.current;
      if (!showLiveRef.current || !view || view.isDestroyed || !docPath) return;
      const imgs = e.payload.paths.filter((p) =>
        IMAGE_EXTS.includes((p.split('.').pop() ?? '').toLowerCase() as (typeof IMAGE_EXTS)[number]));
      if (imgs.length === 0) return;
      view.focus();
      const canImg = dropFormatRef.current === 'html' ? htmlCanInsertImage : mdCanInsertImage;
      if (!canImg(view.state)) {
        onError("Can't insert an image here. Put the cursor in regular text, not in a code block.");
        return;
      }
      for (const path of imgs) {
        try {
          const rel = await copyImageIntoAssets(docPath, path);
          if (disposed || view.isDestroyed) return;
          const display = resolveImageDisplaySrc(rel, docPath);
          if (dropFormatRef.current === 'html') htmlInsertImage(rel, null, display)(view.state, view.dispatch);
          else insertImage(rel, null, null, display)(view.state, view.dispatch);
        } catch (err) {
          if (!disposed) onError(`Could not insert the dropped image. ${String(err)}`);
        }
      }
    }).then((fn) => { if (disposed) fn(); else unlisten = fn; });
    return () => { disposed = true; unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLiveEdit = useCallback((d: PMNode, dirtyIds: Set<string>) => {
    // A highlight transaction carries meta and no steps, so the doc node is
    // the SAME object. HtmlLiveView fires onEdit for those (it gates on state
    // identity, deliberately), so identity is what separates a real edit from a
    // highlight — and what stops find from re-triggering itself.
    const docChanged = d !== liveDocRef.current;
    liveDocRef.current = d;
    liveDirtyRef.current = dirtyIds;
    setLiveHasEdits(dirtyIds.size > 0);
    if (docChanged) bumpFindEpoch();
  }, []);

  const flushToSource = useCallback((): boolean => {
    if (!liveDocRef.current || liveDirtyRef.current.size === 0) return true;
    try {
      const newSource = session.format === 'html'
        ? htmlWriteBack(liveDocRef.current, liveBaselineRef.current, liveDirtyRef.current, liveBaselineDocRef.current ?? undefined)
        : writeBack(liveDocRef.current, liveBaselineRef.current, liveDirtyRef.current, detectFlavor(liveBaselineRef.current, 'markdown'), liveBaselineDocRef.current ?? undefined);
      session.setCurrentText(newSource);
      liveDirtyRef.current = new Set();
      setLiveHasEdits(false);
      onError(null);
      return true;
    } catch (e) {
      onError(`Edtr couldn't safely convert one of your edits back to ${session.format === 'html' ? 'HTML' : 'Markdown'}. Your work is still here in Live view. Please adjust that edit and try again. ${String(e)}`);
      return false;
    }
  }, [session, onError]);

  const surface = useMemo<FindSurface | null>(() => {
    if (showLive) return liveView ? pmSurface(liveView) : null;
    return codeView ? codeSurface(codeView) : null;
  }, [showLive, liveView, codeView]);
  const surfaceRef = useRef(surface); surfaceRef.current = surface;

  // Recompute matches — debounced, and safe to re-run.
  useEffect(() => {
    if (!findOpen || !surface) return;
    const epoch = findEpoch; // the version this run describes — captured now,
    // so the timer callback can't read a NEWER value if another edit lands
    // before it fires (that later edit reschedules its own effect run anyway).
    const timer = setTimeout(() => {
      let run: ReturnType<typeof matchSegments>;
      try {
        run = matchSegments(surface.getSegments(), find.query, { multiline: surface.multiline });
      } catch (e) {
        // A surface driver meeting a node it doesn't understand degrades to
        // "no matches" rather than throwing out of a timer (design §7.3) — an
        // uncaught throw here has no passive-effect boundary to land in and
        // leaves find silently, permanently dead. Surface it through the
        // banner instead of swallowing it (5f's lesson).
        run = { matches: [], capped: false, invalid: false };
        onError(`Edtr couldn't search this document—try switching to Code view, which always works for searching. ${String(e)}`);
      }
      setFind((prev) => setResult(prev.query, run, findAnchorRef.current));
      setFindFor(surface);
      setFindForEpoch(epoch);
    }, FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `find.query` is compared by reference and setResult carries the same
    // object through, so this cannot re-trigger itself.
  }, [findOpen, surface, find.query, findEpoch, onError]);

  // Matches describe one projection at one document version. Consuming them
  // against any other is how reveal() resolves a position that no longer
  // exists and throws out of a passive effect, taking the window down.
  const findFresh = findFor === surface && findForEpoch === findEpoch;

  useEffect(() => {
    // `findFresh` is the stale-matches guard: on a Code<->Live toggle,
    // `surface` has already swapped to the new projection in THIS commit, and
    // on an in-place edit `findEpoch` has already bumped in this commit too —
    // in both cases `find.matches` is still the PREVIOUS run's positions until
    // the debounced recompute lands. Highlighting those against the current
    // surface/version is the same class of bug as the reveal() crash below,
    // just silent instead of throwing.
    if (!surface || !findFresh) return;
    // Clearing is guaranteed by `clear()` emptying `matches` in the same render
    // that closes the bar -- no separate close branch is needed, and one would
    // be redundant. The user-visible guarantee is covered by the
    // 'closes on Escape and clears its highlights' test.
    surface.highlight(find.matches, find.current);
  }, [surface, findFresh, find.matches, find.current]);

  // Reveal the current match — incremental search scrolls to it as the user types.
  useEffect(() => {
    // Same stale-matches guard as the highlight effect above: without it, a
    // Code<->Live toggle OR an in-place edit (⌘G before the debounce settles)
    // resolves a position the current projection/version doesn't have, which
    // is out of range and throws — this is the exact crash the regression
    // tests below reproduce. `reveal()` itself also bounds-checks (defense in
    // depth, see pmSurface.ts/codeSurface.ts) — this guard is what keeps a
    // stale match from being shown at all, not just from crashing.
    if (!findOpen || !surface || !findFresh) return;
    const match = currentMatch(find);
    if (match) surface.reveal(match);
    // Deps are the current match's identity, not `find` — revealing must not
    // re-run for an unrelated state change.
  }, [findOpen, surface, findFresh, find.current, find.matches]);

  const openFind = useCallback(() => {
    // Capture site 1/2 for findAnchorRef: the caret as it is the moment find
    // opens, before anything below can move it.
    findAnchorRef.current = surfaceRef.current?.cursorPos() ?? 0;
    const selected = surfaceRef.current?.selectedText() ?? '';
    // Seed from the selection when there is one; otherwise keep the last term.
    if (selected !== '' && !selected.includes('\n')) {
      setFind((prev) => ({ ...prev, query: { ...prev.query, text: selected } }));
    }
    setFindOpen(true);
    bumpFindFocus(); // ⌘F while already open refocuses and selects the field
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFind((prev) => clearFind(prev));
    // Stamp BOTH to their current values (not e.g. null/-1): a stamp that
    // can never match `findFresh` would make the highlight effect's guard
    // trip on every close too, since it would never equal the live surface or
    // epoch — which blocks the very `highlight([], -1)` call that clears
    // what's on screen. What actually prevents a reopened bar from briefly
    // consuming a stale run is `clearFind` emptying `matches` in this same
    // commit, not the specific values stamped here; stamping the current
    // surface/epoch keeps that guarantee AND lets the effect run once more to
    // clear the display.
    setFindFor(surfaceRef.current);
    setFindForEpoch(findEpoch);
    // Closing must never leave focus nowhere — losing focus is part of what
    // made CodeMirror's panel feel unclosable. The cursor is already at the
    // current match, because reveal selected it.
    surfaceRef.current && (showLive ? liveView?.focus() : codeView?.focus());
  }, [showLive, liveView, codeView, findEpoch]);

  const goNext = useCallback(() => setFind((prev) => nextMatch(prev)), []);
  const goPrev = useCallback(() => setFind((prev) => prevMatch(prev)), []);

  useImperativeHandle(ref, () => ({
    flushToSource, openFind, findNext: goNext, findPrev: goPrev,
  }), [flushToSource, openFind, goNext, goPrev]);

  const findBar = findOpen && surface ? (
    <FindBar
      query={find.query}
      count={countLabel(find)}
      focusToken={findFocusToken}
      onQueryChange={(query: FindQuery) => {
        // Capture site 2/2 for findAnchorRef: the first character of a FRESH
        // search, not every keystroke — a live read here would re-anchor to
        // wherever the PREVIOUS keystroke's reveal() left the caret instead of
        // where the user actually is.
        if (find.query.text === '' && query.text !== '') {
          findAnchorRef.current = surfaceRef.current?.cursorPos() ?? 0;
        }
        setFind((prev) => ({ ...prev, query }));
      }}
      onNext={goNext}
      onPrev={goPrev}
      onClose={closeFind}
    />
  ) : null;

  if (showLive && session.format === 'html' && liveHtml && liveHtml.ok) {
    const pos = livePosition(liveView);
    return (
      <>
        {liveView && (
          <RibbonView view={liveView} controls={htmlRibbon} linkRequest={linkRequest} docPath={session.path ?? null} onError={onError} canInsertImage={htmlCanInsertImage} />
        )}
        {liveView && isHtmlInTable(liveView.state) && (
          <div className="ribbon-context">
            <RibbonView view={liveView} controls={htmlTableRibbon} ariaLabel="Table tools" docPath={session.path ?? null} onError={onError} />
          </div>
        )}
        {findBar}
        <HtmlLiveView
          key={`htmllive-${doc.id}`}
          doc={liveHtml.doc} styleText={liveHtml.styleText} bodyAttrs={liveHtml.bodyAttrs} rootAttrs={liveHtml.rootAttrs}
          editable docPath={session.path ?? null}
          onEdit={handleLiveEdit} onViewReady={setLiveView} onStateChange={bumpRibbon} onLinkShortcut={bumpLinkRequest} onError={onError}
        />
        <StatusBar format={session.format} line={pos?.line} column={pos?.column} />
      </>
    );
  }
  if (showLive && live && live.ok) {
    const pos = livePosition(liveView);
    return (
      <>
        {liveView && (
          <RibbonView view={liveView} controls={markdownRibbon} linkRequest={linkRequest} docPath={session.path ?? null} onError={onError} canInsertImage={mdCanInsertImage} />
        )}
        {liveView && isInTable(liveView.state) && (
          <div className="ribbon-context">
            <RibbonView view={liveView} controls={markdownTableRibbon} ariaLabel="Table tools" docPath={session.path ?? null} onError={onError} />
          </div>
        )}
        {findBar}
        <LiveView
          key={`live-${doc.id}`}
          doc={live.doc} editable
          onEdit={handleLiveEdit} onViewReady={setLiveView} onStateChange={bumpRibbon} onLinkShortcut={bumpLinkRequest} docPath={session.path ?? null} onError={onError}
        />
        <StatusBar format={session.format} line={pos?.line} column={pos?.column} />
      </>
    );
  }
  return (
    <>
      {findBar}
      <CodeView
        key={`code-${doc.id}`} initialText={session.text} format={session.format} effectiveTheme={effectiveTheme}
        onChange={handleChange} onViewReady={setCodeView}
        onCursorChange={(line, column) => setCodeCursor({ line, column })}
      />
      <StatusBar format={session.format} line={codeCursor?.line} column={codeCursor?.column} />
    </>
  );
});
