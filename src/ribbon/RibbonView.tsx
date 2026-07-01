import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import type { RibbonControl, PopoverValues } from './RibbonModel';
import { InsertPopover } from './InsertPopover';

interface RibbonViewProps {
  view: EditorView;
  controls: RibbonControl[];
  /** Incremented by ⌘K to trigger the link control programmatically. */
  linkRequest?: number;
}

export function RibbonView({ view, controls, linkRequest = 0 }: RibbonViewProps) {
  const [popover, setPopover] = useState<{ control: RibbonControl; initialText: string } | null>(null);

  function runCommand(cmd: Command) {
    cmd(view.state, view.dispatch);
    view.focus();
  }

  function activate(control: RibbonControl) {
    const { action } = control;
    if (action.kind === 'command') { runCommand(action.run); return; }
    if (action.kind === 'popover') {
      if (action.whenActiveRun && control.isActive(view.state)) { runCommand(action.whenActiveRun); return; }
      const { from, to } = view.state.selection;
      const initialText = action.popover === 'link' ? view.state.doc.textBetween(from, to) : '';
      setPopover({ control, initialText });
    }
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
    <div className="ribbon" role="toolbar" aria-label="Formatting">
      {controls.map((c) => {
        const isEnabled = c.isEnabled(view.state);
        if (c.action.kind === 'dropdown') {
          const action = c.action;
          return (
            <select
              key={c.id}
              className="ribbon-select"
              aria-label={c.ariaLabel}
              disabled={!isEnabled}
              value={action.getValue(view.state)}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => { runCommand(action.run(e.target.value)); }}
            >
              {action.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          );
        }
        const active = c.isActive(view.state);
        return (
          <button
            key={c.id}
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
        );
      })}
      {popover && popover.control.action.kind === 'popover' && (
        <InsertPopover
          kind={popover.control.action.popover}
          initialText={popover.initialText}
          onConfirm={confirmPopover}
          onCancel={() => { setPopover(null); view.focus(); }}
        />
      )}
    </div>
  );
}
