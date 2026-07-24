import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState,
} from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
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

export interface DocumentViewHandle {
  /** Flush live edits into doc.session.currentText. Returns false if a serializer throw aborted it. */
  flushToSource: () => boolean;
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

  const handleChange = useCallback((text: string) => {
    session.setCurrentText(text);
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
    liveDocRef.current = d;
    liveDirtyRef.current = dirtyIds;
    setLiveHasEdits(dirtyIds.size > 0);
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

  useImperativeHandle(ref, () => ({ flushToSource }), [flushToSource]);

  if (showLive && session.format === 'html' && liveHtml && liveHtml.ok) {
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
        <HtmlLiveView
          key={`htmllive-${doc.id}`}
          doc={liveHtml.doc} styleText={liveHtml.styleText} bodyAttrs={liveHtml.bodyAttrs} rootAttrs={liveHtml.rootAttrs}
          editable docPath={session.path ?? null}
          onEdit={handleLiveEdit} onViewReady={setLiveView} onStateChange={bumpRibbon} onLinkShortcut={bumpLinkRequest} onError={onError}
        />
      </>
    );
  }
  if (showLive && live && live.ok) {
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
        <LiveView
          key={`live-${doc.id}`}
          doc={live.doc} editable
          onEdit={handleLiveEdit} onViewReady={setLiveView} onStateChange={bumpRibbon} onLinkShortcut={bumpLinkRequest} docPath={session.path ?? null} onError={onError}
        />
      </>
    );
  }
  return (
    <CodeView key={`code-${doc.id}`} initialText={session.text} format={session.format} effectiveTheme={effectiveTheme} onChange={handleChange} />
  );
});
