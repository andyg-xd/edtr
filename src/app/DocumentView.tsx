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
import { buildOutline } from '../outline/outlineModel';
import { activeEntryIndex } from '../outline/activeEntry';
import { buildLiveOutline, activeLiveEntryIndex } from '../outline/liveOutline';
import { revealSourceInCode } from '../outline/codeReveal';
import { revealSourceInPm } from '../outline/pmReveal';
import type { OutlineEntry } from '../outline/types';
import { codeSurface } from '../find/codeSurface';
import { pmSurface } from '../find/pmSurface';
import { matchSegments, MATCH_CAP } from '../find/matchText';
import { computeReplacements, type ReplaceEdit } from '../find/replaceText';
import type { FindQuery } from '../find/findQuery';
import {
  clear as clearFind, countLabel, currentMatch, emptyFindState,
  next as nextMatch, prev as prevMatch, setResult, type FindState,
} from '../find/findState';
import type { FindSurface } from '../find/types';
import { ReplaceAllGuard } from './ReplaceAllGuard';
import { codeTypewriter } from '../writingmodes/codeTypewriter';
import { pmTypewriter } from '../writingmodes/pmTypewriter';
import { pmFocus } from '../writingmodes/pmFocus';
import { codeFocus } from '../writingmodes/codeFocus';
import { HOLD_RATIO } from '../writingmodes/constants';
import type { TypewriterSurface, CountSurface, FocusSurface } from '../writingmodes/types';
import { subscribePointerRelease } from '../writingmodes/pointerState';
import { codeCounts, pmCounts } from '../writingmodes/countSurfaces';
import { useWordCount } from '../writingmodes/useWordCount';
import type { WritingMode, WritingModes } from '../settings/writingModes';
import { DocumentToolbar } from './DocumentToolbar';

/**
 * Matching is debounced so a fast typist doesn't re-scan the document on every
 * keystroke. 120ms mirrors --motion-fast; a pathological pattern on a large
 * document can still stall briefly (design §7.2).
 */
const FIND_DEBOUNCE_MS = 120;

/**
 * Above this many matches, Replace All asks first (D5). A threshold rather than
 * always-confirming: a dialog on every two-match edit trains the user to
 * dismiss it unread, which is how a confirmation stops working. Exported so
 * the test that exercises the boundary and this file can never disagree on
 * where it is.
 */
export const REPLACE_ALL_CONFIRM_THRESHOLD = 10;

export interface DocumentViewHandle {
  /** Flush live edits into doc.session.currentText. Returns false if a serializer throw aborted it. */
  flushToSource: () => boolean;
  /** ⌘F — open the find bar, seeding it from the selection, or refocus it if already open. */
  openFind: () => void;
  /** Open the find bar with its replace row showing — same seeding as openFind. */
  openReplace: () => void;
  findNext: () => void;
  findPrev: () => void;
  /** Jump to an outline entry in whichever view is showing (6c-iv). */
  revealOutlineEntry: (entry: OutlineEntry) => void;
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
  /** Writing-mode toggles (typewriter/focus), one subscription per window, shared by every DocumentView in it. */
  modes: WritingModes;
  /** Flips one writing mode on/off — the persistent toolbar's controls call this in every view (6c-iii, Task 6). */
  onSetWritingMode: (mode: WritingMode, on: boolean) => void;
  /** The persistent toolbar's Export button — a placeholder until Task 7 wires the real export flow. */
  onExport: (kind: 'html' | 'pdf') => void;
  onDirtyChange: (dirty: boolean) => void;
  onLiveAvailableChange: (available: boolean) => void;
  onError: (msg: string | null) => void;
  /** A non-destructive, transient notice (e.g. D2's crossing-formatting heads-up, D6's atom disclosure). */
  onInfo: (msg: string) => void;
  /**
   * Report the document's outline and which entry the caret is in (6c-iv).
   * DocumentView derives both — it is the only component that has the source
   * AND the live views — but the panel lives in the window's sidebar, so the
   * state is handed up rather than rendered here.
   */
  onOutlineChange?: (entries: OutlineEntry[], activeIndex: number | null) => void;
}

export const DocumentView = forwardRef<DocumentViewHandle, DocumentViewProps>(function DocumentView(
  { doc, effectiveTheme, modes, onSetWritingMode, onExport, onDirtyChange, onLiveAvailableChange, onError, onInfo, onOutlineChange }, ref,
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
  // The value itself matters here (not just the setter): it is the only
  // existing signal that fires on a Live selection-only change (onStateChange
  // fires on every transaction, this included), which the word count below
  // rides instead of adding a second subscription to the editor.
  const [ribbonTick, bumpRibbon] = useReducer((x: number) => x + 1, 0);
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
  // Replace row state. Independent of `findOpen`/`find` -- closing/reopening
  // find-only (⌘F) must not lose a term the user already typed into replace.
  const [showReplace, setShowReplace] = useState(false);
  const [replaceText, setReplaceText] = useState('');
  // The frozen edit set a big Replace All is asking about. Frozen, not
  // recomputed on confirm: what the guard disclosed (the count, the atom-span
  // count) is exactly what must happen -- recomputing against a document that
  // could theoretically have changed while the dialog was up would make the
  // disclosure a guess instead of a fact.
  //
  // Stamped with the SURFACE and EPOCH the edits were computed against
  // (Finding 1 of the final review), not just the bare array: the modal
  // backdrop has no focus trap and no `inert`, neither editor sets
  // `tabIndex={-1}`, and the native Edit menu's Find/Replace stay live, so a
  // user really can Tab into the editor -- or reach it via the menu -- and
  // edit the document (or toggle Code<->Live) while this dialog is up. Every
  // mutation path already bumps `findEpoch` (`handleChange`, `handleLiveEdit`),
  // so surface identity + epoch together are a sufficient version signal:
  // `confirmReplaceAll` refuses to apply a set stamped against a document
  // version that no longer exists, rather than silently rewriting whatever
  // text now happens to sit at those stale positions.
  const [pendingReplaceAll, setPendingReplaceAll] = useState<{
    edits: ReplaceEdit[];
    surface: FindSurface;
    epoch: number;
    /** Whether this batch was truncated at the cap (Finding 4) — carried
     *  through so the eventual disclosure can say so truthfully. */
    capped: boolean;
  } | null>(null);
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

  const typewriter = useMemo<TypewriterSurface | null>(() => {
    // ONE driver for both Live views (Markdown and HTML) — same as `surface`
    // above for find. Do not add an HTML-specific branch here.
    if (showLive) return liveView ? pmTypewriter(liveView) : null;
    return codeView ? codeTypewriter(codeView) : null;
  }, [showLive, liveView, codeView]);

  const focus = useMemo<FocusSurface | null>(() => {
    // ONE driver for both Live views (Markdown and HTML), same construction as
    // `typewriter`/`surface` above — no HTML-specific branch. Code view gets
    // its own driver (Task 10): a CodeMirror ViewPlugin over visibleRanges,
    // genuinely different from the ProseMirror plugin the Live views share,
    // so it is not forced through the same function.
    if (showLive) return liveView ? pmFocus(liveView) : null;
    return codeView ? codeFocus(codeView) : null;
  }, [showLive, liveView, codeView]);

  const countSurface = useMemo<CountSurface | null>(() => {
    // Same construction as `surface` above, for the same reason: one driver
    // per projection, no HTML-specific branch.
    if (showLive) return liveView ? pmCounts(liveView) : null;
    return codeView ? codeCounts(codeView) : null;
  }, [showLive, liveView, codeView]);
  // `useWordCount`'s `version` just needs to CHANGE whenever the document or
  // selection does, so the debounce inside it restarts — it is never read, only
  // compared by reference. `findEpoch` covers every real edit in either view.
  // Selection-ONLY movement needs one signal per view, and both already exist:
  // `codeCursor` (CodeView's onCursorChange fires on `docChanged ||
  // selectionSet`) for Code, `ribbonTick` (bumped by `handleLiveStateChange`,
  // which fires on every transaction incl. selection-only) for Live. Neither is
  // a new subscription — this just rides state DocumentView already maintains
  // for find/typewriter/the ribbon.
  //
  // A memoized composite key, NOT a `useReducer`+`useEffect` pair that
  // dispatches a derived bump: that shape was tried first and rejected in
  // review — the effect fires strictly AFTER the render that changed one of
  // its deps, so it lands as an unavoidable SECOND commit (React cannot batch
  // a passive effect's setState with the render that scheduled it), on every
  // keystroke in Code view and every transaction in Live view. None of
  // CodeView/LiveView/HtmlLiveView is memoized, so that was a real second
  // re-render of this whole subtree, for a value nobody needs until the 150ms
  // debounce fires anyway. A `useMemo` recomputes the key inline, in the SAME
  // render/commit as the state that changed — no extra commit, same triggers.
  const countVersion = useMemo(
    () => `${findEpoch}:${ribbonTick}:${codeCursor?.line}:${codeCursor?.column}`,
    [findEpoch, ribbonTick, codeCursor],
  );
  const counts = useWordCount(countSurface, countVersion);

  // The outline, derived from the SOURCE so it is correct in every view
  // (spec D2) — never from a live projection, which is only current while its
  // view is showing. Plaintext has no headings; the panel shows its own empty
  // state rather than being hidden.
  const outlineEntries = useMemo(
    () => {
      // A Live view derives from the LIVE DOCUMENT, not the source (A5,
      // 2026-08-26). `session.text` is only updated by `flushToSource`, on
      // save or a view toggle — never per transaction — so a source-derived
      // outline simply cannot see a heading you just typed. The memo was
      // re-running correctly the whole time; its INPUT had not changed.
      // Flushing per keystroke was rejected: it would put the no-beautify
      // write-back path in the hot path of typing.
      if (showLive && liveView) return buildLiveOutline(liveView);
      return session.format === 'markdown' || session.format === 'html'
        ? buildOutline(session.text, session.format)
        : [];
    },
    // `countVersion` is the existing "something changed" signal -- it already
    // covers a Code edit, a Live transaction and a find epoch. Riding it means
    // no second subscription and no second definition of when to recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, countVersion, showLive, liveView],
  );

  // Which entry the caret is in. Code view compares a real source offset;
  // a Live view compares PM positions, which are exact.
  const outlineActive = useMemo(() => {
    if (outlineEntries.length === 0) return null;
    // Live-derived entries carry an exact PM anchor, so the caret compares
    // against it directly. The source-offset path below cannot answer for a
    // caret inside a container — it has to fall back to the CONTAINER's
    // offset, which starts before the heading it holds, so it marks the
    // PREVIOUS heading. That defect is invisible in Markdown, where every
    // heading is top-level, and was found by test rather than by the GUI pass.
    if (showLive && liveView) {
      return activeLiveEntryIndex(outlineEntries, liveView.state.selection.from);
    }
    const offset = codeView ? codeView.state.selection.main.head : null;
    return offset === null ? null : activeEntryIndex(outlineEntries, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineEntries, showLive, liveView, codeView, countVersion]);

  useEffect(() => {
    onOutlineChange?.(outlineEntries, outlineActive);
  }, [onOutlineChange, outlineEntries, outlineActive]);

  // Live views have no `codeCursor`-shaped signal of their own — the caret
  // moving is just another transaction. `onStateChange` already fires on
  // every one of those (incl. selection-only), and is already wired to
  // bumpRibbon below; this is a second consumer of that same callback, not a
  // new one, per its own prop documentation ("Fires on every transaction ...
  // so a ribbon can re-render" — exactly the signal typewriter mode needs
  // too).
  const handleLiveStateChange = useCallback(() => {
    bumpRibbon();
    if (modes.typewriter) typewriter?.holdCaret(HOLD_RATIO);
  }, [modes.typewriter, typewriter]);

  // Declared BEFORE the hold-caret effect below: on the same commit that
  // switches the mode on, effects run in declaration order, so the padding
  // must land first. Reversed, the first hold runs against the pre-padding
  // scroll height, and on a short document near its end the browser clamps
  // the scroll short of the hold ratio with nothing left to re-trigger it.
  useEffect(() => {
    if (!typewriter) return;
    typewriter.setEndPadding(modes.typewriter);
  }, [typewriter, modes.typewriter]);

  // Hold the caret on every cursor move while the mode is on. `codeCursor` is
  // already updated by CodeView's onCursorChange, so this rides an existing
  // signal rather than adding a second one.
  useEffect(() => {
    if (!typewriter || !modes.typewriter) return;
    typewriter.holdCaret(HOLD_RATIO);
  }, [typewriter, modes.typewriter, codeCursor]);

  // Re-arm the hold when a pointer is released (6c-ii-b, F1 follow-up).
  //
  // The drag guard in the drivers suppresses holds while a pointer is down,
  // which is what stops a drag-select running away. But a plain CLICK changes
  // the selection on pointerdown too, so it is suppressed by the same guard —
  // and pointerup carries no selection change, so without this nothing would
  // ever hold for a click. The first keystroke would then hold from a caret
  // that has drifted far off the line, lurching the viewport in one jump.
  // Found in GUI validation of the first version of that guard.
  //
  // Held from the FINAL caret position, after the pointer is up. A release
  // that ends on a range selection still scrolls nothing, because the drivers'
  // collapsed-selection guard rejects it.
  useEffect(() => {
    if (!typewriter || !modes.typewriter) return;
    return subscribePointerRelease(() => typewriter.holdCaret(HOLD_RATIO));
  }, [typewriter, modes.typewriter]);

  // Drive the enable/disable toggle only -- the decoration plugin derives
  // WHICH block is dimmed straight from the editor's own selection state on
  // every transaction, so a caret move needs no effect here at all. This is
  // the only place focus mode needs to be told anything from React.
  useEffect(() => {
    focus?.setFocusEnabled(modes.focus);
  }, [focus, modes.focus]);

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
    // FALSE POSITIVE, suppressed knowingly. `find` is useState, not a ref
    // (`:149`), so these field deps are real and do re-render. The rule
    // pattern-matches any `.current` as a ref, and `FindState` happens to name
    // its match index `current`. Adding `find` itself, which is what the rule
    // asks for, would re-run this on ANY find state change -- exactly what the
    // comment above forbids. Renaming the field would make the rule truthful;
    // logged as debt rather than churning the crash-prone find code today.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // FALSE POSITIVE, suppressed knowingly. `find` is useState, not a ref
    // (`:149`), so these field deps are real and do re-render. The rule
    // pattern-matches any `.current` as a ref, and `FindState` happens to name
    // its match index `current`. Adding `find` itself, which is what the rule
    // asks for, would re-run this on ANY find state change -- exactly what the
    // comment above forbids. Renaming the field would make the rule truthful;
    // logged as debt rather than churning the crash-prone find code today.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, surface, findFresh, find.current, find.matches]);

  // Shared by openFind and openReplace -- the only difference between them is
  // whether the replace row shows, and duplicating the seeding logic below
  // between two callbacks is exactly how it would drift.
  const openFindOrReplace = useCallback((replace: boolean) => {
    // Capture site 1/2 for findAnchorRef: the caret as it is the moment find
    // opens, before anything below can move it.
    findAnchorRef.current = surfaceRef.current?.cursorPos() ?? 0;
    const selected = surfaceRef.current?.selectedText() ?? '';
    // Seed from the selection when there is one; otherwise keep the last term.
    if (selected !== '' && !selected.includes('\n')) {
      setFind((prev) => ({ ...prev, query: { ...prev.query, text: selected } }));
    }
    setShowReplace(replace);
    setFindOpen(true);
    bumpFindFocus(); // ⌘F while already open refocuses and selects the field
  }, []);
  // ⌘F must always land on find-only, even if replace was showing a moment
  // ago -- there is no ⌘F-flavoured "close replace" gesture, so this is it.
  const openFind = useCallback(() => openFindOrReplace(false), [openFindOrReplace]);
  const openReplace = useCallback(() => openFindOrReplace(true), [openFindOrReplace]);

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

  // The one place that applies edits, raises the crossing/atom notices and
  // recomputes -- Replace and Replace All both go through this, so they
  // cannot drift into disclosing different things for the same kind of edit.
  // Applies edits and RETURNS what happened; it deliberately raises no notice
  // itself. `onInfo` drives a single-slot banner (EditorWindow holds one
  // `infoNotice` string), so two calls in one action means the first is
  // overwritten and never seen -- which is how D6's "must be disclosed" turned
  // into disclosing nothing at all when a count report followed it. Every
  // caller composes ONE message instead, via `disclose` below.
  const runEdits = useCallback((edits: ReplaceEdit[]) => {
    const s = surfaceRef.current;
    if (!s || !s.editable() || edits.length === 0) return null;
    const outcome = s.applyEdits(edits);
    // The document changed, so matches must re-scan. This is the SAME path a
    // typed edit takes; replace does not get its own.
    bumpFindEpoch();
    return outcome;
  }, []);

  /**
   * Turn one action's outcome into one banner line.
   *
   * The clauses are the spec's approved strings verbatim, concatenated: D2's
   * crossing notice and D6's atom disclosure both have to survive alongside
   * D5's count, and a single slot means a single message. Once per action,
   * never per occurrence -- `applyEdits` already reduces a whole batch to one
   * boolean and one total.
   */
  const disclose = useCallback((
    outcome: { crossedFormatting: boolean; removedImages: number; removedEmbedded: number } | null,
    lead?: string,
  ) => {
    if (!outcome) return; // nothing was applied -- claim nothing
    const parts: string[] = [];
    if (lead) parts.push(lead);
    if (outcome.crossedFormatting) {
      parts.push('Replaced across formatting. The replacement takes the formatting from the start of the match.');
    }
    // D6: an atom is invisible in the flattened text, so removing one is
    // something the user could not have knowingly consented to. Disclosure is
    // the whole mitigation -- say what went, and ONLY claim survival for the
    // kind that actually survives.
    //
    // Finding 2 of the final review: the old single "picture or embedded
    // item... picture files are still saved" wording was applied to BOTH
    // kinds alike, which is true of an image (its file lives in the assets
    // folder untouched) but false of the other SKIP_ATOMS kind -- a
    // verbatim/inlineVerbatim node is raw HTML Edtr could not parse (an
    // <abbr>, an inline <svg>, a <script>-shaped block, ...), and removing it
    // from the document removes it, full stop; nothing is saved anywhere.
    // `removedImages`/`removedEmbedded` are counted separately by the surface
    // (see pmSurface.ts's `inspectRange`) specifically so this message never
    // has to guess or over-claim again.
    const { removedImages: pics, removedEmbedded: embedded } = outcome;
    if (pics > 0 && embedded === 0) {
      parts.push(pics === 1
        ? 'Replaced across a picture. It was removed from the text, but the picture file is still saved next to your document.'
        : `Replaced across ${pics} pictures. They were removed from the text, but the picture files are still saved next to your document.`);
    } else if (embedded > 0 && pics === 0) {
      parts.push(embedded === 1
        ? 'Replaced across some embedded content. It was removed from the file, and it has not been saved anywhere.'
        : `Replaced across ${embedded} pieces of embedded content. They were removed from the file, and none of it has been saved anywhere.`);
    } else if (pics > 0 && embedded > 0) {
      const pic = pics === 1 ? 'a picture' : `${pics} pictures`;
      const picVerb = pics === 1 ? 'is' : 'are';
      const picNoun = pics === 1 ? 'picture' : 'pictures';
      const rest = embedded === 1 ? 'some embedded content' : `${embedded} pieces of embedded content`;
      parts.push(`Replaced across ${pic} and ${rest}. The ${picNoun} ${picVerb} still saved next to your document, but the embedded content was removed from the file and not saved anywhere.`);
    }
    if (parts.length > 0) onInfo(parts.join(' '));
  }, [onInfo]);

  const onReplace = useCallback(() => {
    const s = surfaceRef.current;
    if (!s || !s.editable()) return;
    // The SAME freshness gate the highlight and reveal effects use. Without
    // it this is the one consumer of `find.matches` that reads them stale:
    // Enter in the replace field fires onReplace, and macOS key repeat is
    // faster than FIND_DEBOUNCE_MS, so a held Enter would replay the
    // pre-edit match position -- silently no-op'ing at best, and at worst
    // rewriting the occurrence it just replaced when the replacement itself
    // re-matches. A stale replace must do nothing, not something wrong.
    if (!findFresh) return;
    const match = currentMatch(find);
    if (!match) return;
    // Computed for the WHOLE document (Replace All needs the same call), then
    // narrowed to the one edit under the current match by position --
    // `computeReplacements` walks the same segments/offset map `matchSegments`
    // used to produce `find.matches`, so the positions agree.
    const edits = computeReplacements(s.getSegments(), find.query, replaceText, { multiline: s.multiline });
    const edit = edits.find((e) => e.from === match.from);
    if (!edit) return;
    // Anchor PAST the replacement, not at its start. This single line both
    // advances to the next match (the point of this button) and stops a
    // replacement that CONTAINS the query from being re-found forever: the
    // next recompute's setResult() looks for the first match at or after this
    // position, so the just-inserted text is behind the anchor, not ahead of it.
    findAnchorRef.current = edit.from + edit.text.length;
    // No count lead: a single Replace is one match by definition, and saying
    // so would be noise. Only the crossing/atom disclosures apply here.
    disclose(runEdits([edit]));
  }, [find, findFresh, replaceText, runEdits, disclose]);

  // Both Replace All paths -- straight through, and via the confirmation --
  // apply and then report the count. D5 says it reports "either way", so the
  // report lives here rather than only after the dialog: a below-threshold
  // batch is still a bulk action, and the count is how the user knows the
  // scope of what just happened without counting highlights. The count is the
  // LEAD of one message, not a second one, so it cannot bury a disclosure.
  //
  // `capped` (Finding 4 of the final review): a batch truncated at the cap is
  // NOT the whole job, and reporting its count the same way as a complete run
  // reads as if it were -- the find bar already signals a capped scan with a
  // "+" in its count, and Replace All needs the equivalent.
  const runReplaceAll = useCallback((edits: ReplaceEdit[], capped: boolean) => {
    const lead = capped
      ? `Replaced the first ${edits.length} matches. There may be more. Run Replace all again to catch the rest.`
      : `Replaced ${edits.length} ${edits.length === 1 ? 'match' : 'matches'}.`;
    disclose(runEdits(edits), lead);
  }, [runEdits, disclose]);

  const onReplaceAll = useCallback(() => {
    const s = surfaceRef.current;
    if (!s || !s.editable()) return;
    // Ask for ONE MORE than the cap allows (Finding 4). `computeReplacements`
    // truncates silently AT whatever cap it is given either way, so a plain
    // call can never tell "there were exactly MATCH_CAP matches" apart from
    // "there were 10x that many and the rest got silently dropped" -- the
    // overflow only becomes visible by requesting room for one extra and
    // checking whether it showed up.
    const probe = computeReplacements(
      s.getSegments(), find.query, replaceText, { multiline: s.multiline, cap: MATCH_CAP + 1 },
    );
    const capped = probe.length > MATCH_CAP;
    const edits = capped ? probe.slice(0, MATCH_CAP) : probe;
    if (edits.length === 0) return;
    if (edits.length > REPLACE_ALL_CONFIRM_THRESHOLD) {
      // D5: large enough to be hard to walk back -- ask first, rather than
      // run and hope. Nothing is applied until the user says yes, in
      // confirmReplaceAll below. Stamped with the surface + epoch this batch
      // was computed against (Finding 1) so a stale confirmation can be
      // refused rather than applied against whatever the document has become.
      setPendingReplaceAll({ edits, surface: s, epoch: findEpoch, capped });
      return;
    }
    runReplaceAll(edits, capped);
  }, [find, replaceText, runReplaceAll, findEpoch]);

  const confirmReplaceAll = useCallback(() => {
    const pending = pendingReplaceAll;
    setPendingReplaceAll(null);
    if (!pending) return;
    // Finding 1 of the final review: the frozen edits are positions in ONE
    // specific document version of ONE specific surface. The modal has no
    // focus trap, so the user can Tab into the editor (or reach it via the
    // native Edit menu, which stays live) and mutate the document -- or
    // toggle Code<->Live -- while this dialog is open. Applying the frozen
    // set against a document that has since moved would rewrite whatever
    // text now happens to sit at those stale positions, silently, while the
    // banner still claims the original count. Refuse the whole batch on
    // either mismatch rather than partially applying it.
    if (pending.surface !== surfaceRef.current || pending.epoch !== findEpoch) {
      onInfo('The document changed before you confirmed, so nothing was replaced. Run Replace all again.');
      return;
    }
    runReplaceAll(pending.edits, pending.capped);
  }, [pendingReplaceAll, runReplaceAll, findEpoch, onInfo]);

  // Cancelling must change absolutely nothing: no edits, no notice, no find-
  // state change. Clearing the pending set is the entire effect.
  const cancelReplaceAll = useCallback(() => setPendingReplaceAll(null), []);

  useImperativeHandle(ref, () => ({
    revealOutlineEntry(entry: OutlineEntry) {
      // Whichever view is showing. Not routed through FindSurface: that
      // interface is find's, and reveal here needs the raw view.
      if (showLive) { if (liveView) revealSourceInPm(liveView, entry); }
      else if (codeView) revealSourceInCode(codeView, entry);
    },
    flushToSource, openFind, openReplace, findNext: goNext, findPrev: goPrev,
    // `showLive`/`liveView`/`codeView` are dependencies because
    // `revealOutlineEntry` CLOSES OVER them (B2, 2026-08-26). Leaving them out
    // pinned the handle to the first render, where `liveView` is still null --
    // so the reveal hit its own `if (liveView)` guard and did nothing, silently.
    // It appeared intermittent because any re-render that changed one of the
    // five callbacks below rebuilt the closure with a live view.
    //
    // The four surface memos above (`surface`, `typewriter`, `focus`,
    // `countSurface`) all declare exactly these three. This handle is the only
    // consumer that did not.
  }), [flushToSource, openFind, openReplace, goNext, goPrev, showLive, liveView, codeView]);

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
      showReplace={showReplace}
      replaceText={replaceText}
      canReplace={surface?.editable() ?? false}
      onReplaceTextChange={setReplaceText}
      onReplace={onReplace}
      onReplaceAll={onReplaceAll}
    />
  ) : null;

  // A Replace All above the threshold asks first (D5). `surface` (not
  // `surfaceRef`) so this stays in sync with the render it belongs to; guarded
  // separately from `pendingReplaceAll` alone because a null surface (surface
  // torn down mid-dialog) must not call `inspectEdits` on nothing.
  const replaceGuard = pendingReplaceAll && surface ? (
    <ReplaceAllGuard
      count={pendingReplaceAll.edits.length}
      atomSpans={surface.inspectEdits(pendingReplaceAll.edits).atomSpans}
      onConfirm={confirmReplaceAll}
      onCancel={cancelReplaceAll}
    />
  ) : null;

  if (showLive && session.format === 'html' && liveHtml && liveHtml.ok) {
    const pos = livePosition(liveView);
    return (
      <>
        <DocumentToolbar
          formatting={liveView && (
            <RibbonView view={liveView} controls={htmlRibbon} linkRequest={linkRequest} docPath={session.path ?? null} onError={onError} canInsertImage={htmlCanInsertImage} />
          )}
          modes={modes} onSetMode={onSetWritingMode} onExport={onExport}
        />
        {liveView && isHtmlInTable(liveView.state) && (
          <div className="ribbon-context">
            <RibbonView view={liveView} controls={htmlTableRibbon} ariaLabel="Table tools" docPath={session.path ?? null} onError={onError} />
          </div>
        )}
        {findBar}
        {replaceGuard}
        <HtmlLiveView
          key={`htmllive-${doc.id}`}
          doc={liveHtml.doc} styleText={liveHtml.styleText} bodyAttrs={liveHtml.bodyAttrs} rootAttrs={liveHtml.rootAttrs}
          editable docPath={session.path ?? null}
          onEdit={handleLiveEdit} onViewReady={setLiveView} onStateChange={handleLiveStateChange} onLinkShortcut={bumpLinkRequest} onError={onError}
        />
        <StatusBar format={session.format} line={pos?.line} column={pos?.column} words={counts?.words} characters={counts?.characters} isSelection={counts?.isSelection} />
      </>
    );
  }
  if (showLive && live && live.ok) {
    const pos = livePosition(liveView);
    return (
      <>
        <DocumentToolbar
          formatting={liveView && (
            <RibbonView view={liveView} controls={markdownRibbon} linkRequest={linkRequest} docPath={session.path ?? null} onError={onError} canInsertImage={mdCanInsertImage} />
          )}
          modes={modes} onSetMode={onSetWritingMode} onExport={onExport}
        />
        {liveView && isInTable(liveView.state) && (
          <div className="ribbon-context">
            <RibbonView view={liveView} controls={markdownTableRibbon} ariaLabel="Table tools" docPath={session.path ?? null} onError={onError} />
          </div>
        )}
        {findBar}
        {replaceGuard}
        <LiveView
          key={`live-${doc.id}`}
          doc={live.doc} editable
          onEdit={handleLiveEdit} onViewReady={setLiveView} onStateChange={handleLiveStateChange} onLinkShortcut={bumpLinkRequest} docPath={session.path ?? null} onError={onError}
        />
        <StatusBar format={session.format} line={pos?.line} column={pos?.column} words={counts?.words} characters={counts?.characters} isSelection={counts?.isSelection} />
      </>
    );
  }
  return (
    <>
      <DocumentToolbar formatting={null} modes={modes} onSetMode={onSetWritingMode} onExport={onExport} />
      {findBar}
      {replaceGuard}
      <CodeView
        key={`code-${doc.id}`} initialText={session.text} format={session.format} effectiveTheme={effectiveTheme}
        onChange={handleChange} onViewReady={setCodeView}
        onCursorChange={(line, column) => setCodeCursor({ line, column })}
      />
      <StatusBar format={session.format} line={codeCursor?.line} column={codeCursor?.column} words={counts?.words} characters={counts?.characters} isSelection={counts?.isSelection} />
    </>
  );
});
