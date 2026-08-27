import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Whether a window's sidebar is showing, and the toggle that flips it.
 *
 * Per-window and never persisted, like the writing modes after 6c-ii-b
 * reversed 6c-ii's D5. No settings call belongs here.
 *
 * WHY THIS IS NOT JUST `useState(hasFiles)` (owner's GUI pass, 2026-08-26).
 * That was the original, and the intent behind it was right: multi-doc and
 * folder windows should start open so nothing disappears for someone who had a
 * sidebar before 6c-iv, while a single document starts closed. But `useState`
 * evaluates its argument ONLY on the first render, and a folder arrives
 * asynchronously from `read_folder` — so at mount `hasFiles` is false, the
 * sidebar started closed, and nothing ever reopened it. The behaviour was
 * written and then silently never happened.
 *
 * Reacting to `hasFiles` alone would be wrong in the other direction: it would
 * spring the sidebar back open every time a document opened or closed, which
 * would make the toggle feel broken and would fight the owner's D-3 decision
 * that closing it must stick. So a deliberate toggle latches, and after that
 * the window's own files stop having an opinion.
 *
 * The window growth (6c-iv-b) rides this ONE state rather than the chrome
 * button, so every path that opens or closes the sidebar resizes with it —
 * including the automatic open when a folder arrives. Wiring it to the click
 * instead would have left that path silently not growing.
 */
export function useSidebarOpen(hasFiles: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(hasFiles);
  // A ref, not state: it must not cause a render of its own, and it is read
  // inside the effect below rather than driving it.
  const userDecided = useRef(false);

  useEffect(() => {
    if (userDecided.current) return;
    if (hasFiles) setOpen(true);
  }, [hasFiles]);

  // Resize the window to match (6c-iv-b). Fire-and-forget on purpose: the
  // sidebar must show or hide whatever the window does, so a failure here
  // degrades to the old behaviour — the pane absorbs the width — rather than
  // blocking the UI. `first` skips the initial mount: a window that starts
  // with its sidebar open was built at that size and must not be grown again.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void invoke('set_sidebar_window_growth', { open }).catch(() => {});
  }, [open]);

  const toggle = useCallback(() => {
    userDecided.current = true;
    setOpen((v) => !v);
  }, []);

  return [open, toggle];
}
