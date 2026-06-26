import type { SpliceEdit } from './types';

/**
 * Apply non-overlapping replacements to `source`. Bytes outside every edit's
 * [start, end) range are copied verbatim. Throws if any two edits overlap.
 */
export function spliceSource(source: string, edits: SpliceEdit[]): string {
  if (edits.length === 0) return source;

  // Sort ascending to validate, then apply descending so earlier offsets stay valid.
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].end > sorted[i + 1].start) {
      throw new Error(
        `Overlapping edits: [${sorted[i].start},${sorted[i].end}) and ` +
          `[${sorted[i + 1].start},${sorted[i + 1].end})`,
      );
    }
  }

  let out = source;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}
