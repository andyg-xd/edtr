/** What the user typed and which toggles are on. */
export interface FindQuery {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export const emptyQuery: FindQuery = {
  text: '',
  matchCase: false,
  wholeWord: false,
  regex: false,
};

export type CompileResult =
  | { ok: true; re: RegExp }
  | { ok: false; reason: 'empty' | 'invalid' };

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a query into the matcher every surface shares.
 *
 * `multiline` comes from the surface, not from counting segments: it is true
 * only for Code view's single whole-document segment, which is what makes
 * `^`/`$` mean line boundaries there and block boundaries in Live view
 * (design §5.3).
 *
 * An invalid regular expression is RETURNED, never thrown. The user is
 * mid-typing an unclosed group for as long as it takes them to type the rest
 * of it, and the bar shows "Invalid pattern" during that time rather than the
 * app falling over.
 *
 * Whole word uses `\b`, not a lookbehind: lookbehind needs Safari 16.4+ and
 * buys nothing over `\b` here. The known edge is inherited from `\b` — a query
 * that starts or ends with a non-word character (e.g. `(`) behaves as `\b`
 * does, which is to say surprisingly. That is the familiar behaviour from
 * every other editor, so it is left alone.
 */
export function compileQuery(query: FindQuery, multiline: boolean): CompileResult {
  if (query.text === '') return { ok: false, reason: 'empty' };
  const body = query.regex ? query.text : escapeLiteral(query.text);
  const source = query.wholeWord ? `\\b(?:${body})\\b` : body;
  const flags = `g${query.matchCase ? '' : 'i'}${multiline ? 'm' : ''}`;
  try {
    return { ok: true, re: new RegExp(source, flags) };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
