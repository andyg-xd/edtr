import type { ReplaceEdit } from './replaceText';

/** A contiguous run of flattened text and where it came from in the editor. */
export interface OffsetRun {
  /** Offset of this run's first character within the segment's flat text. */
  from: number;
  /** How many characters this run contributes. */
  len: number;
  /** Editor document position of this run's first character. */
  pos: number;
}

export interface OffsetMap {
  runs: OffsetRun[];
}

/** One searchable run of text plus the mapping from its offsets back to editor positions. */
export interface Segment {
  text: string;
  map: OffsetMap;
}

/** A match as offsets within one segment's flat text. */
export interface TextMatch {
  start: number;
  end: number;
}

/** A match as editor document positions, ready to decorate or reveal. */
export interface FindMatch {
  from: number;
  to: number;
}

/**
 * What find needs from an editor. Two thin adapters implement it — one per
 * engine — so the core never knows which editor it is searching.
 */
export interface FindSurface {
  /**
   * True when the surface returns ONE whole-document segment, which is what
   * makes `^`/`$` anchor to lines in Code view and to blocks in Live view
   * (design §5.3). Stated by the surface rather than inferred from the segment
   * count — a single-block document would otherwise silently change meaning.
   */
  multiline: boolean;
  getSegments(): Segment[];
  /** Where the caret is, in the same position space as a FindMatch. */
  cursorPos(): number;
  /** The current selection's text, for seeding the find field. '' when empty. */
  selectedText(): string;
  highlight(matches: FindMatch[], current: number): void;
  reveal(match: FindMatch): void;
  /**
   * Whether this surface may be written to. Find works in a read-only HTML
   * preview; replace must not (addendum, read-only gating).
   */
  editable(): boolean;
  /**
   * Apply edits as ONE undo-able step. Edits must be ascending and
   * non-overlapping — `computeReplacements` guarantees both.
   *
   * Returns whether any edit spanned more than one formatting run, which is
   * what raises D2's heads-up notice, and how many invisible inline atoms
   * (an image, a verbatim region — see `flattenBlocks`' `SKIP_ATOMS`) the
   * edits actually removed. D6 (spec §K5): a match's flattened text never
   * shows those atoms, so the user can consent to replacing text that
   * happens to CONTAIN one, but cannot know it was there without being told
   * afterward — the replace still goes through, removal is disclosed rather
   * than refused. Both figures are reported by the surface because only the
   * surface knows what formatting and atoms mean: Code view always returns
   * `{ crossedFormatting: false, removedAtoms: 0 }`, since its source is
   * plain text with neither concept.
   */
  applyEdits(edits: ReplaceEdit[]): { crossedFormatting: boolean; removedAtoms: number };
  /**
   * Pre-flight, read-only count of how many of `edits` would span an
   * invisible atom if applied — same atom definition as `applyEdits`'
   * `removedAtoms`, just counted per-edit instead of totalled, and computed
   * WITHOUT touching the document. Task 5 needs this to disclose the number
   * in Replace All's confirmation before the user commits to anything.
   */
  inspectEdits(edits: ReplaceEdit[]): { atomSpans: number };
}

/** Positions equal offsets — the Code-view case, where the segment IS the source. */
export function identityMap(len: number): OffsetMap {
  return { runs: len > 0 ? [{ from: 0, len, pos: 0 }] : [] };
}

/** Position of the character at `offset`, or null if the offset is outside the map. */
export function mapStart(map: OffsetMap, offset: number): number | null {
  for (const run of map.runs) {
    if (offset >= run.from && offset < run.from + run.len) return run.pos + (offset - run.from);
  }
  return null;
}

/**
 * Position just after the character at `offset - 1`.
 *
 * An END offset must NOT be looked up like a start: at a run boundary the
 * start lookup finds the NEXT run, which — when the two runs have a positional
 * gap between them (an excluded atom) — is a completely different place in the
 * document.
 */
export function mapEnd(map: OffsetMap, offset: number): number | null {
  if (offset <= 0) return null;
  const start = mapStart(map, offset - 1);
  return start === null ? null : start + 1;
}
