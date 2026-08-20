import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { anchorTo } from '../ui/anchorTo';

interface ExportButtonProps {
  onExport: (kind: 'html' | 'pdf') => void;
  /** Off for plaintext, which has neither a Live projection nor HTML source. */
  disabled?: boolean;
}

type Phase = 'measuring' | 'visible';

/**
 * The document-actions zone's export control (6c-iii, Task 7).
 *
 * A trigger plus a two-item menu, following `InsertPopover`'s established
 * contract rather than inventing a second one: measured after mount, placed
 * by the shared `anchorTo` helper so it clamps at the window edges the same
 * way the tooltip does, and dismissed by Escape or an outside mousedown.
 *
 * Unlike `InsertPopover`, the menu is owned by the button rather than by a
 * parent, so the trigger's rect is captured here on open. That also makes the
 * button count as "inside" for the outside-click check -- otherwise the
 * mousedown would close the menu a moment before the click reopened it.
 */
export function ExportButton({ onExport, disabled = false }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('measuring');
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) { setPhase('measuring'); return; }
    const el = menuRef.current;
    const trigger = triggerRef.current;
    if (!el || !trigger) return;
    const box = el.getBoundingClientRect();
    setPos(anchorTo(
      trigger.getBoundingClientRect(),
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    ));
    setPhase('visible');
  }, [open]);

  // Focus has to move INTO the menu, and not only for keyboard users: the
  // Escape handler below is on the menu element, so a keydown raised while
  // focus is still on the trigger bubbles past it and dismisses nothing. A
  // test that dispatches the event straight at the menu cannot see that --
  // it has to be raised from wherever focus really is.
  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const choose = (kind: 'html' | 'pdf') => { setOpen(false); onExport(kind); };
  // Escape puts the caller back where they started, the way a dismissed menu
  // is expected to. An outside click deliberately does NOT, since the click
  // has already chosen somewhere else to be.
  const dismiss = () => { setOpen(false); triggerRef.current?.focus(); };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--secondary ribbon-btn"
        data-testid="export-button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        Export
      </button>
      {open && (
        <div
          ref={menuRef}
          className="export-menu"
          role="menu"
          aria-label="Export as"
          data-testid="export-menu"
          style={{ left: pos.left, top: pos.top, visibility: phase === 'measuring' ? 'hidden' : 'visible' }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } }}
        >
          <button ref={firstItemRef} type="button" role="menuitem" className="export-menu-item" data-testid="export-html" onClick={() => choose('html')}>
            Web page (HTML)
          </button>
          <button type="button" role="menuitem" className="export-menu-item" data-testid="export-pdf" onClick={() => choose('pdf')}>
            PDF
          </button>
        </div>
      )}
    </>
  );
}
