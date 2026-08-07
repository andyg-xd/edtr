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
 *
 * `replace` is deliberately absent: 6c-i-a cannot modify a document at all.
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
