import type { OutlineEntry } from './types';

/**
 * Which entry's section contains `caretOffset` — the last heading that starts
 * at or before the caret.
 *
 * Null before the first heading: that text genuinely belongs to no section,
 * and marking the first heading there would be a lie the panel tells.
 */
export function activeEntryIndex(entries: OutlineEntry[], caretOffset: number): number | null {
  let active: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].srcFrom <= caretOffset) active = i;
    else break;
  }
  return active;
}
