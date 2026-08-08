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
