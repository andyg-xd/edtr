import { compileQuery, type FindQuery } from './findQuery';
import { execAll, MATCH_CAP } from './matchText';
import { mapEnd, mapStart, type Segment } from './types';

/**
 * Expand `$`-substitutions in a replacement template against one match.
 *
 * Groups come from the ORIGINAL exec result rather than from re-running the
 * pattern against the matched substring. Re-matching in isolation is fragile:
 * a lookbehind, or a `\b` that depended on the surrounding characters, will not
 * match the substring on its own, and the replacement would silently come out
 * wrong.
 *
 * Semantics deliberately mirror `String.prototype.replace` (design D3): `$$`,
 * `$&`, `` $` ``, `$'`, and `$1`..`$99`. A reference to a group that does not
 * exist stays literal, exactly as the platform does it. This function is only
 * ever reached when the regular-expression toggle is ON — with it off, the
 * template is used verbatim so a `$` is just a dollar sign (addendum C5).
 */
export function expandReplacement(m: RegExpExecArray, template: string): string {
  const groupCount = m.length - 1;
  let out = '';
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== '$' || i === template.length - 1) {
      out += template[i];
      continue;
    }
    const next = template[i + 1];
    if (next === '$') { out += '$'; i++; continue; }
    if (next === '&') { out += m[0]; i++; continue; }
    if (next === '`') { out += m.input.slice(0, m.index); i++; continue; }
    if (next === "'") { out += m.input.slice(m.index + m[0].length); i++; continue; }
    if (next >= '0' && next <= '9') {
      // Prefer the two-digit reading when that group exists, as String.replace does.
      const one = Number(next);
      const secondDigit = template[i + 2];
      if (secondDigit >= '0' && secondDigit <= '9') {
        const two = Number(template.slice(i + 1, i + 3));
        if (two >= 1 && two <= groupCount) {
          out += m[two] ?? '';
          i += 2;
          continue;
        }
      }
      if (one >= 1 && one <= groupCount) {
        out += m[one] ?? '';
        i++;
        continue;
      }
    }
    out += '$'; // not a substitution — a literal dollar sign
  }
  return out;
}

/** A concrete edit: replace `[from, to)` in editor positions with `text`. */
export interface ReplaceEdit {
  from: number;
  to: number;
  text: string;
}

/**
 * Which occurrences change, and to what — decided once, for every surface.
 *
 * Walks the same segments and uses the same offset map as `matchSegments`, so
 * replace can never disagree with the highlights the user is looking at.
 *
 * Edits come back ascending and non-overlapping, which is the precondition
 * `spliceSource` validates and throws on (spec 6). Per-textblock segmentation
 * (2026-08-07 addendum) is what guarantees an edit never spans a block
 * boundary and the markup between blocks — a beautify-class write.
 */
export function computeReplacements(
  segments: Segment[],
  query: FindQuery,
  template: string,
  opts: { multiline: boolean; cap?: number },
): ReplaceEdit[] {
  const cap = opts.cap ?? MATCH_CAP;
  const compiled = compileQuery(query, opts.multiline);
  if (!compiled.ok) return [];

  const edits: ReplaceEdit[] = [];
  for (const segment of segments) {
    for (const m of execAll(segment.text, compiled.re, cap - edits.length)) {
      const from = mapStart(segment.map, m.index);
      const to = mapEnd(segment.map, m.index + m[0].length);
      // An unmappable offset means the segment and its map disagree. Skip it
      // rather than guess a position and rewrite the wrong text.
      if (from === null || to === null) continue;
      // Literal when the regex toggle is off, so `$` is just a dollar sign.
      const text = query.regex ? expandReplacement(m, template) : template;
      edits.push({ from, to, text });
      if (edits.length >= cap) return edits;
    }
  }
  return edits;
}
