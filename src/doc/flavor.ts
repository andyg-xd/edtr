import type { DocFormat, FlavorProfile } from './types';

const DEFAULTS: FlavorProfile = {
  bullet: '-',
  emphasis: '*',
  strong: '**',
  headingStyle: 'atx',
  fence: '`',
  orderedDelimiter: '.',
  gfm: false,
};

/** Detect the stylistic conventions a document uses, defaulting where absent. */
export function detectFlavor(source: string, format: DocFormat): FlavorProfile {
  if (format !== 'markdown') {
    // HTML has no markdown-style flavor; return defaults (unused for HTML serialization).
    return { ...DEFAULTS };
  }
  const f: FlavorProfile = { ...DEFAULTS };

  const bullet = source.match(/^[ \t]*([-*+])[ \t]+\S/m);
  if (bullet) f.bullet = bullet[1] as FlavorProfile['bullet'];

  // Frequency-based strong detection: count occurrences of each marker style per line,
  // pick the one with more occurrences; tie or zero → keep default (**).
  {
    const underscoreStrongRe = /(^|[^_])__[^_\s][^\n]*?__/g;
    const starStrongRe = /(^|[^*])\*\*[^*\s][^\n]*?\*\*/g;
    const usCount = (source.match(underscoreStrongRe) ?? []).length;
    const ssCount = (source.match(starStrongRe) ?? []).length;
    if (usCount > ssCount) f.strong = '__';
    else if (ssCount > usCount) f.strong = '**';
    // tie or both zero → keep default '**'
  }

  // Frequency-based emphasis detection: count occurrences of each marker style per line,
  // pick the one with more occurrences; tie or zero → keep default (*).
  {
    const underscoreEmRe = /(^|[^_])_[^_\s][^\n]*?_(?!_)/g;
    const starEmRe = /(^|[^*])\*[^*\s][^\n]*?\*(?!\*)/g;
    const ueCount = (source.match(underscoreEmRe) ?? []).length;
    const seCount = (source.match(starEmRe) ?? []).length;
    if (ueCount > seCount) f.emphasis = '_';
    else if (seCount > ueCount) f.emphasis = '*';
    // tie or both zero → keep default '*'
  }

  if (/^[ \t]*~~~/m.test(source)) f.fence = '~';
  if (/^\s*\d+\)[ \t]+/m.test(source)) f.orderedDelimiter = ')';
  if (/^.+\n(=+|-+)\s*$/m.test(source)) f.headingStyle = 'setext';

  // GFM signals: pipe table delimiter row, task list, or strikethrough.
  if (/^\s*\|?[ \t:-]*\|[ \t:|-]*$/m.test(source) || /^\s*[-*+] \[[ xX]\]/m.test(source) || /~~[^~]+~~/.test(source)) {
    f.gfm = true;
  }
  return f;
}
