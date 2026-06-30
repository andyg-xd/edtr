import { useEffect, useRef, useState } from 'react';
import type { PopoverValues } from './RibbonModel';

interface InsertPopoverProps {
  kind: 'link' | 'image';
  initialText?: string;
  onConfirm: (values: PopoverValues) => void;
  onCancel: () => void;
}

export function InsertPopover({ kind, initialText = '', onConfirm, onCancel }: InsertPopoverProps) {
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
        <input ref={urlRef} value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <div className="insert-popover-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={submit} disabled={!canConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}
