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

  if (/(^|[^_])__[^_\s][\s\S]*?__/.test(source)) f.strong = '__';
  else if (/(^|[^*])\*\*[^*\s][\s\S]*?\*\*/.test(source)) f.strong = '**';

  // Single-marker emphasis, avoiding the double-marker (strong) case.
  if (/(^|[^_])_[^_\s][\s\S]*?_(?!_)/.test(source)) f.emphasis = '_';
  else if (/(^|[^*])\*[^*\s][\s\S]*?\*(?!\*)/.test(source)) f.emphasis = '*';

  if (/^[ \t]*~~~/m.test(source)) f.fence = '~';
  if (/^\s*\d+\)[ \t]+/m.test(source)) f.orderedDelimiter = ')';
  if (/^.+\n(=+|-+)\s*$/m.test(source)) f.headingStyle = 'setext';

  // GFM signals: pipe table delimiter row, task list, or strikethrough.
  if (/^\s*\|?[ \t:-]*\|[ \t:|-]*$/m.test(source) || /^\s*[-*+] \[[ xX]\]/m.test(source) || /~~[^~]+~~/.test(source)) {
    f.gfm = true;
  }
  return f;
}
