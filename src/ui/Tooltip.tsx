import { cloneElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactElement } from 'react';
import { anchorTo } from './anchorTo';

/** 150ms, not the system's 1-2s -- fast enough to teach an unfamiliar toolbar. */
const SHOW_DELAY_MS = 150;

interface TooltipProps {
  /** The action's accessible name, shown as the tooltip's text. */
  label: string;
  /** Display form of the keyboard shortcut, e.g. '⌘B'. Rendered as a key cap when present. */
  shortcut?: string;
  /** id placed on the tooltip element; the child gets aria-describedby pointing at it. */
  id: string;
  /**
   * A single focusable control (button, select, ...). Typed `any` deliberately:
   * this wrapper works over any host element's prop shape, and the precise
   * element type isn't something callers need Tooltip to enforce.
   */
  children: ReactElement<any>;
}

type Phase = 'hidden' | 'measuring' | 'visible';

/**
 * Custom tooltip. We reject native `title` because its 1-2s delay is poor at
 * teaching an unfamiliar toolbar and it can't be styled for dark mode -- the
 * cost of that choice is accessibility, which is why every trigger MUST carry
 * aria-describedby (wired here, unconditionally, regardless of visibility).
 */
export function Tooltip({ label, shortcut, id, children }: TooltipProps) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function scheduleShow() {
    clearTimer();
    timerRef.current = setTimeout(() => setPhase('measuring'), SHOW_DELAY_MS);
  }

  function hide() {
    clearTimer();
    setPhase('hidden');
  }

  // Never let a pending show-timer fire after the trigger has unmounted.
  useEffect(() => clearTimer, []);

  // The tooltip's real size depends on its rendered label/shortcut, so it's
  // mounted invisibly first, measured, then positioned with anchorTo and
  // revealed -- anchorTo needs the floating element's actual box, not a guess.
  useLayoutEffect(() => {
    if (phase !== 'measuring') return;
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const triggerRect = trigger.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    setPos(
      anchorTo(
        triggerRect,
        { width: tipRect.width, height: tipRect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    setPhase('visible');
  }, [phase]);

  const child = cloneElement(children, {
    // Compose rather than replace: the child may already carry a ref (e.g.
    // RibbonView querying it up by attribute doesn't need this, but any
    // other future caller might), and silently dropping it makes any ref on
    // a tooltip-wrapped element permanently null -- the same reasoning as
    // every event handler composed below. React 19 exposes a passed-in ref
    // as `children.props.ref` (a regular prop); reading `children.ref`
    // directly is deprecated and logs a console warning in this React
    // version, even though it still returns the value.
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      const inherited = (children.props as { ref?: unknown }).ref;
      if (typeof inherited === 'function') inherited(node);
      else if (inherited && typeof inherited === 'object') {
        (inherited as { current: HTMLElement | null }).current = node;
      }
    },
    'aria-describedby': id,
    onMouseEnter: (e: MouseEvent) => { children.props.onMouseEnter?.(e); scheduleShow(); },
    onMouseLeave: (e: MouseEvent) => { children.props.onMouseLeave?.(e); hide(); },
    onFocus: (e: FocusEvent) => { children.props.onFocus?.(e); scheduleShow(); },
    onBlur: (e: FocusEvent) => { children.props.onBlur?.(e); hide(); },
    onKeyDown: (e: KeyboardEvent) => {
      children.props.onKeyDown?.(e);
      if (e.key === 'Escape') hide();
    },
  });

  const rendered = phase !== 'hidden';

  return (
    <>
      {child}
      {rendered && (
        <div
          ref={tipRef}
          role="tooltip"
          id={id}
          className="tooltip"
          style={{ left: pos.left, top: pos.top, visibility: phase === 'measuring' ? 'hidden' : 'visible' }}
        >
          <span className="tooltip-label">{label}</span>
          {shortcut && <kbd className="tooltip-shortcut">{shortcut}</kbd>}
        </div>
      )}
    </>
  );
}
