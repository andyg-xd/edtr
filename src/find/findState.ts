import { emptyQuery, type FindQuery } from './findQuery';
import type { MatchRun } from './matchText';
import type { FindMatch } from './types';

export interface FindState {
  query: FindQuery;
  matches: FindMatch[];
  /** Index into `matches`, or -1 when there is nothing to be on. */
  current: number;
  capped: boolean;
  invalid: boolean;
}

export const emptyFindState: FindState = {
  query: emptyQuery,
  matches: [],
  current: -1,
  capped: false,
  invalid: false,
};

/**
 * Adopt a fresh match run. The new current match is the first one at or after
 * `cursorPos`, so a search starts from where the user is looking rather than
 * from the top of the file, wrapping to the first match when the cursor is
 * past the last one.
 */
export function setResult(
  state: FindState,
  query: FindQuery,
  run: MatchRun,
  cursorPos = 0,
): FindState {
  const { matches, capped, invalid } = run;
  if (matches.length === 0) return { query, matches, current: -1, capped, invalid };
  const at = matches.findIndex((m) => m.from >= cursorPos);
  return { query, matches, current: at === -1 ? 0 : at, capped, invalid };
}

export function next(state: FindState): FindState {
  if (state.matches.length === 0) return state;
  return { ...state, current: (state.current + 1) % state.matches.length };
}

export function prev(state: FindState): FindState {
  if (state.matches.length === 0) return state;
  const n = state.matches.length;
  return { ...state, current: (state.current - 1 + n) % n };
}

/** Drop the results but keep the query — reopening the bar keeps the term. */
export function clear(state: FindState): FindState {
  return { ...emptyFindState, query: state.query };
}

export function currentMatch(state: FindState): FindMatch | null {
  return state.current >= 0 ? state.matches[state.current] ?? null : null;
}

/**
 * The reader-facing count. Plain language, no developer terms.
 *
 * A capped run reads "1/5000+" rather than the spec's bare "5000+": the design
 * intent is to signal "there are more than this", and keeping the position
 * alongside it costs nothing and loses nothing.
 */
export function countLabel(state: FindState): string {
  if (state.invalid) return 'Invalid pattern';
  if (state.query.text === '') return '';
  if (state.matches.length === 0) return 'No results';
  const total = `${state.matches.length}${state.capped ? '+' : ''}`;
  return `${state.current + 1}/${total}`;
}
