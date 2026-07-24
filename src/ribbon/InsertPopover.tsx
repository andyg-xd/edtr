import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { PopoverValues } from './RibbonModel';
import { copyImageIntoAssets, resolveImageDisplaySrc, IMAGE_EXTS } from '../files/imageAssets';

interface InsertPopoverProps {
  kind: 'link' | 'image';
  initialText?: string;
  /** Absolute path of the open document; enables the local-image file picker. */
  docPath?: string | null;
  onConfirm: (values: PopoverValues) => void;
  onCancel: () => void;
  /** Surfaces a copy/write failure via the app's non-destructive error banner. */
  onError?: (msg: string) => void;
  /** Returns false when an image can't be inserted at the current selection. */
  canInsertImage?: () => boolean;
}

export function InsertPopover({ kind, initialText = '', docPath = null, onConfirm, onCancel, onError, canInsertImage }: InsertPopoverProps) {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => { urlRef.current?.focus(); }, []);

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
        <button type="button" onClick={chooseFile} disabled={!docPath}>Choose file…</button>
      )}
      <div className="insert-popover-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={submit} disabled={!canConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}
