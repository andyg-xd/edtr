/**
 * What a link in a document points at, decided without touching anything.
 *
 * `file` is only ever returned for the five kinds of file Edtr itself edits
 * (the same list as the open panel), and such a link only ever opens inside
 * Edtr. That is what keeps a link from launching a program: `run.command`,
 * `Some.app` and `setup.sh` are refused here rather than handed to the OS.
 */
export type LinkTarget =
  | { kind: 'web'; url: string }
  | { kind: 'file'; path: string }
  | { kind: 'section' }
  | { kind: 'unsupported'; reason: 'empty' | 'scheme' | 'file-type' | 'unsaved' | 'malformed' };

const OPENABLE_EXTENSIONS = new Set(['md', 'markdown', 'html', 'htm', 'txt']);
const WEB_SCHEMES = new Set(['http', 'https', 'mailto']);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

export function classifyLink(href: string, docPath: string | null): LinkTarget {
  // Browsers ignore tab, CR and LF inside a URL, which is how `java\tscript:`
  // gets past a naive scheme check. Strip them the same way before deciding.
  const raw = href.replace(/[\t\n\r]/g, '').trim();
  if (raw === '') return { kind: 'unsupported', reason: 'empty' };
  if (raw.startsWith('#')) return { kind: 'section' };
  if (raw.startsWith('//')) return { kind: 'web', url: `https:${raw}` };

  const scheme = SCHEME.exec(raw)?.[1].toLowerCase();
  if (scheme === 'file') return fileTarget(raw.slice('file://'.length), null);
  if (scheme !== undefined) {
    return WEB_SCHEMES.has(scheme) ? { kind: 'web', url: raw } : { kind: 'unsupported', reason: 'scheme' };
  }
  return fileTarget(raw, docPath);
}

function fileTarget(ref: string, docPath: string | null): LinkTarget {
  const withoutSuffix = ref.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    return { kind: 'unsupported', reason: 'malformed' };
  }
  if (decoded === '') return { kind: 'unsupported', reason: 'empty' };

  let path: string;
  if (decoded.startsWith('/')) path = normalize(decoded);
  else if (docPath === null) return { kind: 'unsupported', reason: 'unsaved' };
  else path = normalize(`${docPath.slice(0, docPath.lastIndexOf('/'))}/${decoded}`);

  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return OPENABLE_EXTENSIONS.has(ext) ? { kind: 'file', path } : { kind: 'unsupported', reason: 'file-type' };
}

/** Collapse `.`, `..` and repeated slashes in an absolute POSIX path. */
function normalize(absolute: string): string {
  const out: string[] = [];
  for (const part of absolute.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}
