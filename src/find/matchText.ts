import { compileQuery, type FindQuery } from './findQuery';
import { mapEnd, mapStart, type FindMatch, type Segment, type TextMatch } from './types';

/**
 * Beyond this many matches the count reads "n/5000+" and matching stops. A
 * pathological pattern on a large document can still stall briefly (design
 * §7.2) — the cap bounds the damage, it does not eliminate it.
 */
export const MATCH_CAP = 5000;

export interface MatchRun {
  matches: FindMatch[];
  capped: boolean;
  invalid: boolean;
}

/**
 * Every non-overlapping match of `re` in `text`, in order.
 *
 * Zero-length matches are DROPPED and stepped over. A pattern like `a*` or `^`
 * matches empty at every position: without the guard `exec` never advances and
 * the loop hangs, and an empty highlight is nothing a user could see or
 * navigate to anyway.
 */
export function matchText(text: string, re: RegExp): TextMatch[] {
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const out: TextMatch[] = [];
  rx.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    if (m[0].length === 0) {
      rx.lastIndex += 1;
      if (rx.lastIndex > text.length) break;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Run a query across ordered segments and return editor positions.
 *
 * ONE matcher serves all three surfaces (design §5.1). Two engines would mean
 * two definitions of "whole word" and two regex flavours, and every semantic
 * question would have to be answered twice and would be free to drift.
 */
export function matchSegments(
  segments: Segment[],
  query: FindQuery,
  opts: { multiline: boolean; cap?: number },
): MatchRun {
  const cap = opts.cap ?? MATCH_CAP;
  const compiled = compileQuery(query, opts.multiline);
  if (!compiled.ok) {
    return { matches: [], capped: false, invalid: compiled.reason === 'invalid' };
  }
  const matches: FindMatch[] = [];
  for (const segment of segments) {
    for (const tm of matchText(segment.text, compiled.re)) {
      const from = mapStart(segment.map, tm.start);
      const to = mapEnd(segment.map, tm.end);
      // An unmappable offset means the segment and its map disagree. Skip it
      // rather than guess a position and decorate the wrong text.
      if (from === null || to === null) continue;
      matches.push({ from, to });
      if (matches.length >= cap) return { matches, capped: true, invalid: false };
    }
  }
  return { matches, capped: false, invalid: false };
}
