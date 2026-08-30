import { useEffect, useRef, useState } from 'react';

/**
 * Debounce in milliseconds. Exact, so a test can assert it.
 *
 * Longer than the word count's 150ms because the work behind it is roughly
 * three orders of magnitude larger: `countText` measured 0.03 / 0.71 / 2.57 ms
 * at 200 / 5 000 / 20 000 lines, `buildOutline` 7.92 / 185.77 / 758.59 ms at
 * the same sizes.
 */
export const OUTLINE_DEBOUNCE_MS = 200;

/**
 * A single, stable value returned whenever the panel is hidden.
 *
 * Identity is the point: this feeds a `useMemo` dependency array, so returning
 * a fresh object (or the live version) would recompute the outline for a panel
 * nobody is looking at.
 */
const HIDDEN = Symbol('outline-hidden');

/**
 * When the outline is allowed to recompute.
 *
 * `buildOutline` is a FULL document parse. It used to ride a version key that
 * every keystroke bumps, and it ran regardless of whether the outline panel
 * was open — so typing in a large file re-parsed the whole document
 * synchronously on every character, for a panel that was usually closed. The
 * owner measured that as an ~10 second per-keystroke delay on a large file.
 *
 * Two independent guarantees, because they were two independent problems:
 *
 *   1. **Hidden -> never.** A closed panel returns `HIDDEN` forever, so the
 *      consuming memo holds its last value and no parse is scheduled at all.
 *   2. **Visible -> only once the document settles.** While the version keeps
 *      changing (i.e. while someone is typing) the timer keeps restarting, so
 *      the parse happens after the burst rather than inside it.
 *
 * Opening the panel settles IMMEDIATELY rather than waiting out the debounce:
 * an outline that appears a fifth of a second after you open the panel reads
 * as slow, and there is no burst to coalesce at that moment.
 */
export function useOutlineTrigger(visible: boolean, version: unknown): unknown {
  const [settled, setSettled] = useState<unknown>(version);
  // Whether the panel was already open on the previous run of this effect.
  // A ref rather than state: it must not itself trigger a render.
  const wasVisible = useRef(false);

  useEffect(() => {
    if (!visible) {
      wasVisible.current = false;
      return;
    }
    if (!wasVisible.current) {
      wasVisible.current = true;
      setSettled(version);
      return;
    }
    const t = setTimeout(() => setSettled(version), OUTLINE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [visible, version]);

  return visible ? settled : HIDDEN;
}
