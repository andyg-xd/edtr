import { Fragment, useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Command, EditorState } from 'prosemirror-state';
import type { RibbonControl, PopoverValues } from './RibbonModel';
import { InsertPopover } from './InsertPopover';
import { TableSizePicker } from './TableSizePicker';
import { Tooltip } from '../ui/Tooltip';

interface RibbonViewProps {
  view: EditorView;
  controls: RibbonControl[];
  /** Incremented by ⌘K to trigger the link control programmatically. */
  linkRequest?: number;
  ariaLabel?: string;
  /** Absolute path of the open document; enables the local-image file picker. */
  docPath?: string | null;
  /** Surfaces a copy/write failure via the app's non-destructive error banner. */
  onError?: (msg: string) => void;
  /** Format-specific "can an image be inserted at the current selection" check. */
  canInsertImage?: (state: EditorState) => boolean;
}

export function RibbonView({ view, controls, linkRequest = 0, ariaLabel = 'Formatting', docPath = null, onError, canInsertImage }: RibbonViewProps) {
  const [popover, setPopover] = useState<{ control: RibbonControl; initialText: string; triggerRect: DOMRect } | null>(null);
  const [sizePicker, setSizePicker] = useState<RibbonControl | null>(null);
  const ribbonRef = useRef<HTMLDivElement>(null);

  function runCommand(cmd: Command) {
    cmd(view.state, view.dispatch);
    view.focus();
  }

  // Looks the control's button up by data-control-id rather than a ref
  // stored on the button element itself: each button is rendered as the
  // child of a Tooltip, which clones its child and overwrites `ref` with
  // its own (to track hover/focus for showing the tooltip) -- a ref placed
  // directly on the button here would silently never reach the DOM.
  // Querying by attribute sidesteps that without touching Tooltip. Works
  // uniformly for both a click (control is on-screen and rendered) and a
  // programmatic activation (⌘K), since neither needs the triggering event.
  function findTriggerRect(controlId: string): DOMRect {
    // controlId always comes from a RibbonControl defined in source (e.g.
    // 'link', 'image', 'heading'), never user input, so a plain attribute
    // selector is safe without CSS.escape.
    const el = ribbonRef.current?.querySelector<HTMLElement>(`[data-control-id="${controlId}"]`);
    return el?.getBoundingClientRect() ?? new DOMRect();
  }

  function activate(control: RibbonControl) {
    const { action } = control;
    if (action.kind === 'command') { runCommand(action.run); return; }
    if (action.kind === 'popover') {
      if (action.whenActiveRun && control.isActive(view.state)) { runCommand(action.whenActiveRun); return; }
      const { from, to } = view.state.selection;
      const initialText = action.popover === 'link' ? view.state.doc.textBetween(from, to) : '';
      setPopover({ control, initialText, triggerRect: findTriggerRect(control.id) });
      return;
    }
    if (action.kind === 'sizePicker') { setSizePicker(control); return; }
  }

  const prevLinkRequest = useRef(linkRequest);

  // ⌘K (an increase in linkRequest) → trigger the link control.
  useEffect(() => {
    if (linkRequest > prevLinkRequest.current) {
      const link = controls.find((c) => c.id === 'link');
      if (link && link.isEnabled(view.state)) activate(link);
    }
    prevLinkRequest.current = linkRequest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkRequest]);

  function confirmPopover(values: PopoverValues) {
    if (popover && popover.control.action.kind === 'popover') {
      const ok = popover.control.action.buildCommand(values)(view.state, view.dispatch);
      if (ok) { setPopover(null); view.focus(); }
      return;
    }
    setPopover(null);
  }

  return (
    <div className="ribbon" role="toolbar" aria-label={ariaLabel} ref={ribbonRef}>
      {controls.map((c, i) => {
        // A divider marks a group boundary; none leads or trails the row
        // since i > 0 excludes the first control.
        const divider = i > 0 && controls[i - 1].group !== c.group
          ? <span className="ribbon-divider" aria-hidden="true" />
          : null;
        const isEnabled = c.isEnabled(view.state);
        if (c.action.kind === 'dropdown') {
          const action = c.action;
          return (
            <Fragment key={c.id}>
              {divider}
              <Tooltip label={c.ariaLabel} shortcut={c.shortcut} id={`tip-${c.id}`}>
                <select
                  className="ribbon-select"
                  aria-label={c.ariaLabel}
                  disabled={!isEnabled}
                  value={action.getValue(view.state)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => { runCommand(action.run(e.target.value)); }}
                >
                  {action.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Tooltip>
            </Fragment>
          );
        }
        const active = c.isActive(view.state);
        return (
          <Fragment key={c.id}>
            {divider}
            <Tooltip label={c.ariaLabel} shortcut={c.shortcut} id={`tip-${c.id}`}>
              <button
                data-control-id={c.id}
                type="button"
                className={`ribbon-btn${active ? ' is-active' : ''}`}
                aria-label={c.ariaLabel}
                aria-pressed={active}
                disabled={!isEnabled}
                onMouseDown={(e) => e.preventDefault()} // keep the editor selection on click
                onClick={() => activate(c)}
              >
                {c.label}
              </button>
            </Tooltip>
          </Fragment>
        );
      })}
      {popover && popover.control.action.kind === 'popover' && (
        <InsertPopover
          kind={popover.control.action.popover}
          initialText={popover.initialText}
          triggerRect={popover.triggerRect}
          docPath={docPath}
          onConfirm={confirmPopover}
          onCancel={() => { setPopover(null); view.focus(); }}
          onError={onError}
          canInsertImage={canInsertImage ? () => canInsertImage(view.state) : undefined}
        />
      )}
      {sizePicker && sizePicker.action.kind === 'sizePicker' && (
        <TableSizePicker
          onSelect={(rows, cols) => {
            if (sizePicker.action.kind === 'sizePicker') {
              sizePicker.action.buildCommand(rows, cols)(view.state, view.dispatch);
            }
            setSizePicker(null);
            view.focus();
          }}
          onCancel={() => { setSizePicker(null); view.focus(); }}
        />
      )}
    </div>
  );
}
