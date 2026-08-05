import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { PopoverValues } from './RibbonModel';
import { copyImageIntoAssets, resolveImageDisplaySrc, IMAGE_EXTS } from '../files/imageAssets';
import { anchorTo } from '../ui/anchorTo';

interface InsertPopoverProps {
  kind: 'link' | 'image';
  initialText?: string;
  /** Absolute path of the open document; enables the local-image file picker. */
  docPath?: string | null;
  /** The DOM rect of the ribbon control that opened this popover -- positions
   *  it via `anchorTo`, the same helper the tooltip uses. */
  triggerRect: DOMRect;
  onConfirm: (values: PopoverValues) => void;
  onCancel: () => void;
  /** Surfaces a copy/write failure via the app's non-destructive error banner. */
  onError?: (msg: string) => void;
  /** Returns false when an image can't be inserted at the current selection. */
  canInsertImage?: () => boolean;
}

type Phase = 'measuring' | 'visible';

export function InsertPopover({ kind, initialText = '', docPath = null, triggerRect, onConfirm, onCancel, onError, canInsertImage }: InsertPopoverProps) {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('measuring');
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => { urlRef.current?.focus(); }, []);

  // The popover's own size depends on its rendered content, so it's measured
  // after mount (mirroring Tooltip): read its box, position it beneath
  // `triggerRect` via the shared anchorTo helper, then reveal it -- this is
  // what makes it clamp identically to the tooltip at the window edges,
  // instead of always opening flush to the ribbon's left edge.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPos(anchorTo(triggerRect, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight }));
    setPhase('visible');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerRect]);

  // Dismiss on a mousedown outside the popover (registered next tick so the
  // opening click isn't treated as "outside").
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onCancel();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onCancel]);

  const canConfirm = url.trim().length > 0;
  const submit = () => { if (canConfirm) onConfirm({ text, url: url.trim() }); };
  const firstLabel = kind === 'link' ? 'Text' : 'Alt text';
  const confirmLabel = kind === 'link' ? 'Add link' : 'Add image';

  const chooseFile = async () => {
    if (!docPath) return;
    if (canInsertImage && !canInsertImage()) {
      onError?.("Can't insert an image here. Put the cursor in regular text, not in a code block.");
      onCancel(); // the image can't go here — close the popover
      return;
    }
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: [...IMAGE_EXTS] }],
      });
      if (typeof picked !== 'string') return; // cancelled
      const rel = await copyImageIntoAssets(docPath, picked);
      onConfirm({ text, url: rel, displaySrc: resolveImageDisplaySrc(rel, docPath) });
    } catch (err) {
      onError?.(`Edtr couldn't add that image. ${String(err)}`);
    }
  };

  return (
    <div
      ref={rootRef}
      className="insert-popover"
      role="dialog"
      aria-label={kind === 'link' ? 'Insert link' : 'Insert image'}
      style={{ left: pos.left, top: pos.top, visibility: phase === 'measuring' ? 'hidden' : 'visible' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
        else if (e.key === 'Enter') { e.preventDefault(); submit(); }
      }}
    >
      <label className="insert-popover-field">
        {firstLabel}
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="insert-popover-field">
        URL
        <input
          ref={urlRef}
          value={url}
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          inputMode="url"
        />
      </label>
      {kind === 'image' && (
        <button type="button" className="btn btn--secondary" onClick={chooseFile} disabled={!docPath}>Choose file…</button>
      )}
      <div className="insert-popover-actions">
        <button type="button" className="btn btn--secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={submit} disabled={!canConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}
